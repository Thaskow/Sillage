#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if !sillage_lib::hooks::run_cli() && !sillage_lib::host::run_cli() {
        sillage_lib::run();
    }
}
