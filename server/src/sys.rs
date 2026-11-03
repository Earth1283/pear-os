use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sysinfo::{Disks, Pid, ProcessesToUpdate, Signal, System};

use crate::Shared;

pub async fn info(State(s): State<Shared>) -> Json<serde_json::Value> {
    let (cpu_brand, cores, total_mem, used_mem, cpu) = {
        let mut sys = s.sys.lock().unwrap();
        sys.refresh_memory();
        sys.refresh_cpu_usage();
        let brand = sys.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default();
        (brand, sys.cpus().len(), sys.total_memory(), sys.used_memory(), sys.global_cpu_usage())
    };
    let disk = Disks::new_with_refreshed_list().ok().and_then(|disks| {
        disks
            .iter()
            .filter(|d| s.root.starts_with(d.mount_point()))
            .max_by_key(|d| d.mount_point().as_os_str().len())
            .map(|d| (d.total_space(), d.available_space()))
    });
    let load = System::load_average().ok();
    Json(json!({
        "hostname": System::host_name().unwrap_or_default(),
        "os": System::long_os_version().unwrap_or_default(),
        "kernel": System::kernel_version().unwrap_or_default(),
        "arch": std::env::consts::ARCH,
        "user": crate::current_user(),
        "cpu": cpu_brand,
        "cores": cores,
        "physicalCores": System::physical_core_count().ok(),
        "cpuUsage": cpu,
        "memTotal": total_mem,
        "memUsed": used_mem,
        "uptime": System::uptime().unwrap_or(0),
        "load": load.map(|l| [l.one, l.five, l.fifteen]),
        "diskTotal": disk.map(|d| d.0),
        "diskFree": disk.map(|d| d.1),
        "root": s.root.display().to_string(),
    }))
}

#[derive(Serialize)]
pub struct Proc {
    pid: u32,
    name: String,
    cpu: f32,
    mem: u64,
    threads: usize,
    mine: bool,
    status: String,
}

pub async fn procs(State(s): State<Shared>) -> Json<Vec<Proc>> {
    let mut sys = s.sys.lock().unwrap();
    sys.refresh_cpu_usage();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let me = sysinfo::get_current_pid().ok().and_then(|p| sys.process(p)).and_then(|p| p.user_id().cloned());
    let mut out: Vec<Proc> = sys
        .processes()
        .values()
        .filter(|p| p.thread_kind().is_none())
        .map(|p| Proc {
            pid: p.pid().as_u32(),
            name: p.name().to_string_lossy().into_owned(),
            cpu: p.cpu_usage(),
            mem: p.memory(),
            threads: p.tasks().map(|t| t.len()).unwrap_or(1).max(1),
            mine: me.is_some() && p.user_id() == me.as_ref(),
            status: p.status().to_string(),
        })
        .collect();
    out.sort_by(|a, b| b.cpu.total_cmp(&a.cpu).then(b.mem.cmp(&a.mem)));
    out.truncate(200);
    Json(out)
}

#[derive(Deserialize)]
pub struct KillBody {
    pid: u32,
    #[serde(default)]
    force: bool,
}

pub async fn kill(State(s): State<Shared>, Json(b): Json<KillBody>) -> Response {
    let sys = s.sys.lock().unwrap();
    let me_pid = sysinfo::get_current_pid().ok();
    if me_pid == Some(Pid::from_u32(b.pid)) {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "pearosd declines to force quit itself" }))).into_response();
    }
    let me = me_pid.and_then(|p| sys.process(p)).and_then(|p| p.user_id().cloned());
    let Some(p) = sys.process(Pid::from_u32(b.pid)) else {
        return (StatusCode::NOT_FOUND, Json(json!({ "error": "no such process" }))).into_response();
    };
    if me.is_none() || p.user_id() != me.as_ref() {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "that process belongs to another user" }))).into_response();
    }
    let ok = if b.force { p.kill() } else { p.kill_with(Signal::Term).unwrap_or_else(|| p.kill()) };
    Json(json!({ "ok": ok })).into_response()
}
