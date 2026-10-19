fn main() {
    use std::{env, fs, path::PathBuf};
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../config/environments.json");
    println!("cargo:rerun-if-changed={}", path.display());
    for key in [
        "SLAX_DESKTOP_ENV",
        "SLAX_DESKTOP_API_ORIGIN",
        "SLAX_DESKTOP_WEB_ORIGIN",
    ] {
        println!("cargo:rerun-if-env-changed={key}");
    }
    let profiles: serde_json::Value =
        serde_json::from_slice(&fs::read(path).expect("Desktop environment profiles are required"))
            .expect("Invalid desktop environment profiles");
    let name = env::var("SLAX_DESKTOP_ENV").unwrap_or_else(|_| "local".into());
    let mut profile = profiles
        .get(&name)
        .cloned()
        .filter(|v| v.is_object())
        .expect("Choose SLAX_DESKTOP_ENV=local|preview|beta|main");
    profile["environment"] = name.into();
    match (
        env::var("SLAX_DESKTOP_API_ORIGIN"),
        env::var("SLAX_DESKTOP_WEB_ORIGIN"),
    ) {
        (Ok(api), Ok(web)) => {
            profile["apiOrigin"] = api.into();
            profile["webOrigin"] = web.into();
        }
        (Err(_), Err(_)) => {}
        _ => panic!("Override both desktop API and Web origins together"),
    }
    let output = PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("desktop-environment.json");
    fs::write(output, serde_json::to_vec(&profile).unwrap())
        .expect("Could not generate desktop environment");
    tauri_build::build()
}
