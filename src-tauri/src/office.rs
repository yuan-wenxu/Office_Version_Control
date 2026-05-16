use std::{fs::File, io::Read, path::Path};

use zip::ZipArchive;

type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

pub fn is_supported_office_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("docx" | "xlsx" | "pptx")
    )
}

pub fn detect_office_kind(path: &Path) -> Result<&'static str> {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("docx") => Ok("docx"),
        Some("xlsx") => Ok("xlsx"),
        Some("pptx") => Ok("pptx"),
        _ => Err("Unsupported Office file type.".into()),
    }
}

pub fn extract_office_text(path: &Path) -> Result<String> {
    match detect_office_kind(path)? {
        "docx" => extract_docx_text(path),
        "xlsx" => extract_xlsx_text(path),
        "pptx" => extract_pptx_text(path),
        _ => Ok(String::new()),
    }
}

fn extract_docx_text(path: &Path) -> Result<String> {
    let mut zip = open_zip(path)?;
    let mut parts = Vec::new();
    for name in sorted_names(&mut zip) {
        if name == "word/document.xml"
            || name.starts_with("word/header")
            || name.starts_with("word/footer")
        {
            let xml = read_zip_text(&mut zip, &name)?;
            parts.push(extract_xml_text(&xml));
        }
    }
    Ok(normalize_text(&parts.join("\n\n")))
}

fn extract_xlsx_text(path: &Path) -> Result<String> {
    let mut zip = open_zip(path)?;
    let shared_strings = read_zip_text(&mut zip, "xl/sharedStrings.xml")
        .map(|xml| {
            extract_xml_text(&xml)
                .lines()
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut parts = Vec::new();
    for name in sorted_names(&mut zip) {
        if name.starts_with("xl/worksheets/sheet") && name.ends_with(".xml") {
            let xml = read_zip_text(&mut zip, &name)?;
            let mut text = extract_xml_text(&xml);
            for (index, value) in shared_strings.iter().enumerate() {
                text = text.replace(&format!("\n{index}\n"), &format!("\n{value}\n"));
            }
            parts.push(format!("# {name}\n{text}"));
        }
    }
    Ok(normalize_text(&parts.join("\n\n")))
}

fn extract_pptx_text(path: &Path) -> Result<String> {
    let mut zip = open_zip(path)?;
    let mut parts = Vec::new();
    for name in sorted_names(&mut zip) {
        if name.starts_with("ppt/slides/slide") && name.ends_with(".xml") {
            let xml = read_zip_text(&mut zip, &name)?;
            parts.push(format!("# {name}\n{}", extract_xml_text(&xml)));
        }
    }
    Ok(normalize_text(&parts.join("\n\n")))
}

fn open_zip(path: &Path) -> Result<ZipArchive<File>> {
    Ok(ZipArchive::new(File::open(path)?)?)
}

fn sorted_names(zip: &mut ZipArchive<File>) -> Vec<String> {
    let mut names = zip.file_names().map(str::to_string).collect::<Vec<_>>();
    names.sort_by(|a, b| natord(a, b));
    names
}

fn read_zip_text(zip: &mut ZipArchive<File>, name: &str) -> Result<String> {
    let mut file = zip.by_name(name)?;
    let mut text = String::new();
    file.read_to_string(&mut text)?;
    Ok(text)
}

fn extract_xml_text(xml: &str) -> String {
    let mut output = String::new();
    let mut in_tag = false;
    let mut entity = String::new();
    let mut in_entity = false;

    for ch in xml.chars() {
        match ch {
            '<' => {
                flush_word_gap(&mut output);
                in_tag = true;
                in_entity = false;
                entity.clear();
            }
            '>' => in_tag = false,
            '&' if !in_tag => {
                in_entity = true;
                entity.clear();
            }
            ';' if in_entity => {
                output.push_str(decode_entity(&entity));
                in_entity = false;
                entity.clear();
            }
            _ if in_entity => entity.push(ch),
            _ if !in_tag => output.push(ch),
            _ => {}
        }
    }

    output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn decode_entity(entity: &str) -> &str {
    match entity {
        "lt" => "<",
        "gt" => ">",
        "amp" => "&",
        "quot" => "\"",
        "apos" => "'",
        _ => "",
    }
}

fn flush_word_gap(output: &mut String) {
    if !output.ends_with('\n') {
        output.push('\n');
    }
}

fn normalize_text(value: &str) -> String {
    value
        .replace("\r\n", "\n")
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn natord(a: &str, b: &str) -> std::cmp::Ordering {
    a.cmp(b)
}
