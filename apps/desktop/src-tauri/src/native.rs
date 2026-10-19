use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2_app_kit::{
    NSWorkspace, NSWorkspaceDidWakeNotification, NSWorkspaceWillSleepNotification,
};
use objc2_foundation::{NSNotification, NSObjectProtocol, NSString};
use slax_core::runtime::Runtime;
use std::{
    ffi::{c_char, c_void},
    ptr::NonNull,
    sync::Arc,
};
use tauri::{Emitter, Manager};

#[link(name = "Network", kind = "framework")]
unsafe extern "C" {
    fn nw_path_monitor_create() -> *mut c_void;
    fn nw_path_monitor_set_update_handler(m: *mut c_void, b: *const c_void);
    fn nw_path_monitor_set_queue(m: *mut c_void, q: *mut c_void);
    fn nw_path_monitor_start(m: *mut c_void);
    fn nw_path_monitor_cancel(m: *mut c_void);
    fn nw_release(m: *mut c_void);
    fn nw_path_get_status(p: *mut c_void) -> i32;
    fn nw_path_is_expensive(p: *mut c_void) -> bool;
    fn nw_path_is_constrained(p: *mut c_void) -> bool;
}
unsafe extern "C" {
    fn dispatch_queue_create(label: *const c_char, attr: *const c_void) -> *mut c_void;
    fn dispatch_release(q: *mut c_void);
}
thread_local! {static NETWORK:std::cell::Cell<Option<(usize,usize)>>=const{std::cell::Cell::new(None)};static STORES:std::cell::RefCell<Vec<(system_configuration::dynamic_store::SCDynamicStore,core_foundation::runloop::CFRunLoopSource)>>=const{std::cell::RefCell::new(Vec::new())};static OBSERVERS:std::cell::RefCell<Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>>>=const{std::cell::RefCell::new(Vec::new())};}
pub fn install(app: tauri::AppHandle, core: Arc<Runtime>) {
    let network_core = core.clone();
    let network_app = app.clone();
    let update = RcBlock::new(move |path: *mut c_void| {
        let mut state = network_core.system.read().unwrap().clone();
        unsafe {
            state.online = nw_path_get_status(path) == 1;
            state.expensive = nw_path_is_expensive(path);
            state.constrained = nw_path_is_constrained(path)
        }
        let r = network_core.clone();
        let a = network_app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = r.signal(state.clone()).await;
            let _ = a.emit("system-state", state);
        });
    });
    // Network.framework copies the handler and retains its dispatch queue for monitor lifetime.
    unsafe {
        let monitor = nw_path_monitor_create();
        let queue = dispatch_queue_create(c"app.slax.reader.network".as_ptr(), std::ptr::null());
        nw_path_monitor_set_update_handler(monitor, (&*update) as *const _ as *const c_void);
        nw_path_monitor_set_queue(monitor, queue);
        nw_path_monitor_start(monitor);
        NETWORK.with(|v| v.set(Some((monitor as usize, queue as usize))));
    }
    let proxy_context = system_configuration::dynamic_store::SCDynamicStoreCallBackContext {
        callout: |_, _, core: &mut Arc<Runtime>| {
            let core = core.clone();
            tauri::async_runtime::spawn(async move {
                let _ = core.proxy_changed().await;
            });
        },
        info: core.clone(),
    };
    if let Some(store) = system_configuration::dynamic_store::SCDynamicStoreBuilder::new(
        "Slax Reader proxy observation",
    )
    .callback_context(proxy_context)
    .build()
    {
        use core_foundation::{
            array::CFArray,
            runloop::{CFRunLoop, kCFRunLoopCommonModes},
            string::CFString,
        };
        let keys = CFArray::from_CFTypes(&[
            CFString::new("State:/Network/Global/Proxies"),
            CFString::new("Setup:/Network/Global/Proxies"),
        ]);
        let patterns = CFArray::from_CFTypes(&[
            CFString::new("Setup:/Network/Service/.*/Proxies"),
            CFString::new("State:/Network/Service/.*/Proxies"),
        ]);
        if store.set_notification_keys(&keys, &patterns)
            && let Some(source) = store.create_run_loop_source()
        {
            unsafe {
                CFRunLoop::get_main().add_source(&source, kCFRunLoopCommonModes);
            }
            STORES.with(|v| v.borrow_mut().push((store, source)));
        }
    }
    let workspace = NSWorkspace::sharedWorkspace();
    let center = workspace.notificationCenter();
    for (name, sleeping) in unsafe {
        [
            (NSWorkspaceWillSleepNotification, true),
            (NSWorkspaceDidWakeNotification, false),
        ]
    } {
        let r = core.clone();
        let a = app.clone();
        let block = RcBlock::new(move |_: NonNull<NSNotification>| {
            let mut state = r.system.read().unwrap().clone();
            state.sleeping = sleeping;
            let r = r.clone();
            let a = a.clone();
            tauri::async_runtime::spawn(async move {
                let _ = r.signal(state.clone()).await;
                let _ = a.emit("system-state", state);
            });
        });
        let observer = unsafe {
            center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &block)
        };
        OBSERVERS.with(|v| v.borrow_mut().push(observer));
    }
    let accessibility = {
        let app = app.clone();
        let core = core.clone();
        move || {
            let a = app.clone();
            let r = core.clone();
            let _ = app.run_on_main_thread(move || accessibility_changed(&a, &r));
        }
    };
    accessibility();
    let block = RcBlock::new(move |_: NonNull<NSNotification>| accessibility());
    let name = NSString::from_str("NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification");
    let observer = unsafe {
        center.addObserverForName_object_queue_usingBlock(Some(&name), None, None, &block)
    };
    OBSERVERS.with(|v| v.borrow_mut().push(observer));
}
fn accessibility_changed(a: &tauri::AppHandle, r: &Arc<Runtime>) {
    let workspace = NSWorkspace::sharedWorkspace();
    let (transparency, motion): (bool, bool) = unsafe {
        (
            objc2::msg_send![&*workspace, accessibilityDisplayShouldReduceTransparency],
            objc2::msg_send![&*workspace, accessibilityDisplayShouldReduceMotion],
        )
    };
    let old = r.system.read().unwrap().clone();
    if old.reduce_transparency == transparency && old.reduce_motion == motion {
        return;
    }
    let mut state = old;
    state.reduce_transparency = transparency;
    state.reduce_motion = motion;
    *r.system.write().unwrap() = state.clone();
    if let Some(w) = a.get_webview_window("main") {
        if transparency {
            let _ = window_vibrancy::clear_vibrancy(&w);
        } else {
            let _ = window_vibrancy::apply_vibrancy(
                &w,
                window_vibrancy::NSVisualEffectMaterial::Sidebar,
                Some(window_vibrancy::NSVisualEffectState::FollowsWindowActiveState),
                None,
            );
        }
    }
    let _ = a.emit("system-state", state);
}

pub fn shutdown() {
    unsafe {
        NETWORK.with(|v| {
            if let Some((monitor, queue)) = v.take() {
                nw_path_monitor_cancel(monitor as *mut c_void);
                nw_release(monitor as *mut c_void);
                dispatch_release(queue as *mut c_void);
            }
        });
    }
    STORES.with(|stores| {
        for (_, source) in stores.borrow_mut().drain(..) {
            unsafe {
                core_foundation::runloop::CFRunLoop::get_main()
                    .remove_source(&source, core_foundation::runloop::kCFRunLoopCommonModes);
            }
        }
    });
    let center = NSWorkspace::sharedWorkspace().notificationCenter();
    OBSERVERS.with(|v| {
        for observer in v.borrow_mut().drain(..) {
            unsafe {
                let object: &objc2::runtime::AnyObject = (*observer).as_ref();
                center.removeObserver(object);
            }
        }
    });
}
