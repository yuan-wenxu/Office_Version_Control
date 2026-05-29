use std::{
    fs,
    net::{IpAddr, Ipv4Addr},
    path::{Path, PathBuf},
};

use rcgen::{
    date_time_ymd, BasicConstraints, CertificateParams, DistinguishedName, DnType,
    ExtendedKeyUsagePurpose, IsCa, KeyPair, KeyUsagePurpose, SanType,
};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

const CA_CERT: &str = "ovc-localhost-ca.crt";
const CA_KEY: &str = "ovc-localhost-ca.key";
const SERVER_CERT: &str = "ovc-localhost.crt";
const SERVER_KEY: &str = "ovc-localhost.key";

pub fn generate_office_certs(addin_root: &Path) -> Result<()> {
    let certs = cert_dir(addin_root);
    fs::create_dir_all(&certs)?;

    let ca_key = KeyPair::generate()?;
    let mut ca_params = CertificateParams::default();
    ca_params.not_before = date_time_ymd(2024, 1, 1);
    ca_params.not_after = date_time_ymd(2039, 1, 1);
    ca_params.distinguished_name = DistinguishedName::new();
    ca_params
        .distinguished_name
        .push(DnType::CommonName, "OVC Localhost CA");
    ca_params.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
    ca_params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
    let ca_cert = ca_params.self_signed(&ca_key)?;

    let server_key = KeyPair::generate()?;
    let mut server_params = CertificateParams::new(vec!["localhost".to_string()])?;
    server_params.not_before = date_time_ymd(2024, 1, 1);
    server_params.not_after = date_time_ymd(2039, 1, 1);
    server_params.distinguished_name = DistinguishedName::new();
    server_params
        .distinguished_name
        .push(DnType::CommonName, "localhost");
    server_params
        .subject_alt_names
        .push(SanType::IpAddress(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))));
    server_params.is_ca = IsCa::ExplicitNoCa;
    server_params.key_usages = vec![
        KeyUsagePurpose::DigitalSignature,
        KeyUsagePurpose::KeyEncipherment,
    ];
    server_params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    let server_cert = server_params.signed_by(&server_key, &ca_cert, &ca_key)?;

    write_private(&certs.join(CA_KEY), &ca_key.serialize_pem())?;
    write_public(&certs.join(CA_CERT), &ca_cert.pem())?;
    write_private(&certs.join(SERVER_KEY), &server_key.serialize_pem())?;
    write_public(&certs.join(SERVER_CERT), &server_cert.pem())?;

    Ok(())
}

pub fn ensure_office_certs(addin_root: &Path) -> Result<()> {
    let certs = cert_dir(addin_root);
    if [CA_CERT, CA_KEY, SERVER_CERT, SERVER_KEY]
        .iter()
        .all(|name| certs.join(name).exists())
    {
        return Ok(());
    }
    generate_office_certs(addin_root)
}

fn cert_dir(addin_root: &Path) -> PathBuf {
    addin_root.join("certs")
}

fn write_private(path: &Path, content: &str) -> Result<()> {
    write_public(path, content)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn write_public(path: &Path, content: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, content)?;
    Ok(())
}
