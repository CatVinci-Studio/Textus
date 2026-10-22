//! The native menu bar built from its items, ids and accelerators.

use super::*;

/// Build and set the whole menu bar, then register the id -> event dispatch.
/// Called once from setup.
pub(crate) fn install(app: &tauri::App) -> tauri::Result<()> {
    app.manage(MenuLabels::default());
    app.manage(RecentMenu(Mutex::new(None)));
    app.manage(ViewChecks::default());
    app.manage(MenuAccelerators::default());
    app.manage(PluginMenu::default());
    set_menu(app.handle(), &HashMap::new())?;
    app.on_menu_event(move |app_handle, event| dispatch(app_handle, event.id().as_ref()));
    Ok(())
}

/// Builds the menu bar with `labels` and makes it the app's, Open Recent
/// filled from the persisted list.
pub(crate) fn set_menu(app: &AppHandle, labels: &HashMap<String, String>) -> tauri::Result<()> {
    let checked = app.state::<ViewChecks>().0.lock().unwrap().checked.clone();
    let accelerators = app.state::<MenuAccelerators>().0.lock().unwrap().clone();
    let built = build(app, labels, &checked, &accelerators)?;
    app.set_menu(built.menu)?;
    *app.state::<RecentMenu>().0.lock().unwrap() = Some(built.open_recent);
    app.state::<ViewChecks>().0.lock().unwrap().items = built.check_items;
    *app.state::<PluginMenu>().submenu.lock().unwrap() = Some(built.plugins);
    rebuild_recent_menu(app);
    rebuild_plugin_menu(app);
    Ok(())
}

/// The whole menu bar, its Open Recent submenu (built empty) and the View
/// menu's on/off items, marked as `checked` has them, and the heading
/// levels with the keys in `accelerators`.
pub(crate) fn build(
    app: &AppHandle,
    labels: &HashMap<String, String>,
    checked: &HashMap<String, bool>,
    accelerators: &HashMap<String, String>,
) -> tauri::Result<BuiltMenu> {
    let l = |key: &str, english: &'static str| label(labels, key, english);
    let name = app_identity::APP_NAME;
    // Accelerators below are written "CmdOrCtrl+X", never "Cmd+X". They read
    // the same on macOS - both parse to ⌘ - but muda maps a bare CMD to
    // SUPER, which on Windows is the WINDOWS key. That silently handed our
    // shortcuts to the OS: Cmd+P became Win+P (the projection panel),
    // Cmd+Shift+S became Win+Shift+S (the screenshot tool), and none of them
    // ever reached the app.
    let settings_item =
        MenuItemBuilder::with_id(SETTINGS_MENU_ID, l(SETTINGS_MENU_ID, "Settings…"))
            .accelerator("CmdOrCtrl+,")
            .build(app)?;

    // Custom Quit instead of the predefined one: quitting must give
    // every window's unsaved document its close-confirmation prompt,
    // so it goes through each window's normal close request rather
    // than exiting the process outright.
    let quit_item = {
        let quit = format!("Quit {name}");
        let builder = MenuItemBuilder::with_id(QUIT_ID, label(labels, QUIT_ID, &quit));
        // Cmd+Q on macOS, Ctrl+Q on Linux - but Windows has no such combo.
        // There the app is closed with Alt+F4, which the OS delivers on its
        // own, and Ctrl+Q means nothing, so claiming it would only take a
        // shortcut Windows users never aim at Quit. The app-drawn menu
        // advertises Alt+F4 instead (src/app/app-menu-model.ts).
        #[cfg(not(windows))]
        let builder = builder.accelerator("CmdOrCtrl+Q");
        builder.build(app)?
    };

    let app_menu = {
        let about = format!("About {name}");
        let builder = SubmenuBuilder::new(app, name)
            .about_with_text(label(labels, "predefined:about", &about), None)
            .separator()
            .item(&settings_item);
        // Hide / Hide Others / Show All are macOS application-menu concepts.
        // muda still renders them elsewhere, so on Windows they were three
        // entries that did nothing when clicked.
        #[cfg(target_os = "macos")]
        let builder = {
            let hide = format!("Hide {name}");
            builder
                .separator()
                .hide_with_text(label(labels, "predefined:hide", &hide))
                .hide_others_with_text(l("predefined:hide-others", "Hide Others"))
                .show_all_with_text(l("predefined:show-all", "Show All"))
        };
        builder.separator().item(&quit_item).build()?
    };

    // Windows draws its menu inside the webview, so New/Open are captured by
    // App.tsx and routed back through dispatch below. Keeping native
    // accelerators there as well risks either losing them while editor focus
    // is active or firing both paths. macOS/Linux keep their visible native
    // menu accelerators.
    let new_file_builder = MenuItemBuilder::with_id(NEW_FILE_ID, l(NEW_FILE_ID, "New File"));
    #[cfg(not(windows))]
    let new_file_builder = new_file_builder.accelerator("CmdOrCtrl+N");
    let new_file_item = new_file_builder.build(app)?;

    let open_file_builder = MenuItemBuilder::with_id(OPEN_FILE_ID, l(OPEN_FILE_ID, "Open…"));
    #[cfg(not(windows))]
    let open_file_builder = open_file_builder.accelerator("CmdOrCtrl+O");
    let open_file_item = open_file_builder.build(app)?;
    // No accelerator: Cmd+Shift+O is the sidebar's file search, a
    // configurable shortcut the frontend handles.
    let open_folder_item =
        MenuItemBuilder::with_id(OPEN_FOLDER_ID, l(OPEN_FOLDER_ID, "Open Folder…")).build(app)?;
    let close_folder_item =
        MenuItemBuilder::with_id(CLOSE_FOLDER_ID, l(CLOSE_FOLDER_ID, "Close Folder")).build(app)?;
    // Built empty here; rebuild_recent_menu below fills it from the
    // persisted list and keeps it current as files are opened.
    let open_recent_menu =
        SubmenuBuilder::new(app, l("menu:open-recent", "Open Recent")).build()?;
    let save_file_item = MenuItemBuilder::with_id(SAVE_FILE_ID, l(SAVE_FILE_ID, "Save"))
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let save_file_as_item =
        MenuItemBuilder::with_id(SAVE_FILE_AS_ID, l(SAVE_FILE_AS_ID, "Save As…"))
            .accelerator("CmdOrCtrl+Shift+S")
            .build(app)?;
    let export_pdf_item = MenuItemBuilder::with_id(EXPORT_PDF_ID, l(EXPORT_PDF_ID, "PDF…"))
        .accelerator("CmdOrCtrl+P")
        .build(app)?;
    let export_html_item =
        MenuItemBuilder::with_id(EXPORT_HTML_ID, l(EXPORT_HTML_ID, "HTML…")).build(app)?;
    let mut export_menu_builder = SubmenuBuilder::new(app, l("menu:export", "Export"))
        .item(&export_pdf_item)
        .item(&export_html_item)
        .separator();
    // Everything below converts through a user-installed pandoc
    // (commands/export.rs) - same format list Typora offers.
    for (format, label) in [
        ("docx", "Word (.docx)…"),
        ("odt", "OpenDocument (.odt)…"),
        ("rtf", "RTF…"),
        ("epub", "EPUB…"),
        ("latex", "LaTeX…"),
        ("mediawiki", "MediaWiki…"),
        ("rst", "reStructuredText…"),
        ("textile", "Textile…"),
        ("opml", "OPML…"),
    ] {
        let id = format!("{EXPORT_PANDOC_PREFIX}{format}");
        let item = MenuItemBuilder::with_id(&id, l(&id, label)).build(app)?;
        export_menu_builder = export_menu_builder.item(&item);
    }
    let export_menu = export_menu_builder.build()?;

    // Cmd+W closes the current tab (not the window - see
    // CLOSE_WINDOW_ID below, which owns Cmd+Shift+W instead).
    let close_tab_item = MenuItemBuilder::with_id(CLOSE_TAB_ID, l(CLOSE_TAB_ID, "Close Tab"))
        .accelerator("CmdOrCtrl+W")
        .build(app)?;

    let file_menu = SubmenuBuilder::new(app, l("menu:file", "File"))
        .item(&new_file_item)
        .item(&open_file_item)
        .item(&open_folder_item)
        .item(&open_recent_menu)
        .item(&close_folder_item)
        .separator()
        .item(&save_file_item)
        .item(&save_file_as_item)
        .separator()
        .item(&export_menu)
        .separator()
        .item(&close_tab_item)
        .build()?;

    // No fixed accelerator - the combo is user-configurable and
    // handled by the frontend keydown dispatcher (see
    // toggle_source_mode_item's comment below for why).
    let find_replace_item =
        MenuItemBuilder::with_id(FIND_REPLACE_ID, l(FIND_REPLACE_ID, "Find & Replace…"))
            .build(app)?;
    let copy_as_markdown_item = MenuItemBuilder::with_id(
        COPY_AS_MARKDOWN_ID,
        l(COPY_AS_MARKDOWN_ID, "Copy as Markdown"),
    )
    .build(app)?;

    let edit_menu = SubmenuBuilder::new(app, l("menu:edit", "Edit"))
        .undo_with_text(l("predefined:undo", "Undo"))
        .redo_with_text(l("predefined:redo", "Redo"))
        .separator()
        .cut_with_text(l("predefined:cut", "Cut"))
        .copy_with_text(l("predefined:copy", "Copy"))
        .item(&copy_as_markdown_item)
        .paste_with_text(l("predefined:paste", "Paste"));
    #[cfg(target_os = "macos")]
    let edit_menu = edit_menu.item(
        &MenuItemBuilder::with_id(SELECT_ALL_ID, l("predefined:select-all", "Select All"))
            .accelerator("CmdOrCtrl+A")
            .build(app)?,
    );
    #[cfg(not(target_os = "macos"))]
    let edit_menu = edit_menu.select_all_with_text(l("predefined:select-all", "Select All"));
    let edit_menu = edit_menu.separator().item(&find_replace_item).build()?;

    let mut format_menu_builder = SubmenuBuilder::new(app, l("menu:format", "Format"));
    for (kind, label) in [
        ("h1", "Heading 1"),
        ("h2", "Heading 2"),
        ("h3", "Heading 3"),
        ("h4", "Heading 4"),
        ("h5", "Heading 5"),
        ("h6", "Heading 6"),
    ] {
        let id = format!("{INSERT_BLOCK_PREFIX}{kind}");
        let item = MenuItemBuilder::with_id(&id, l(&id, label)).build(app)?;
        // Set after the build: a key muda can't read leaves the item
        // without one, where the builder would fail the whole bar.
        if let Some(accelerator) = accelerators.get(&id) {
            let _ = item.set_accelerator(Some(accelerator));
        }
        format_menu_builder = format_menu_builder.item(&item);
    }
    format_menu_builder = format_menu_builder.separator();
    for (kind, label) in [
        ("bullet-list", "Bullet List"),
        ("ordered-list", "Numbered List"),
        ("blockquote", "Blockquote"),
        ("code-block", "Code Block"),
        ("table", "Table"),
    ] {
        let id = format!("{INSERT_BLOCK_PREFIX}{kind}");
        let item = MenuItemBuilder::with_id(&id, l(&id, label)).build(app)?;
        format_menu_builder = format_menu_builder.item(&item);
    }
    let format_menu = format_menu_builder.build()?;

    // No fixed accelerators on these - their shortcuts are
    // user-configurable and handled by the frontend keydown
    // dispatcher (App.tsx), which reads the current bindings from
    // Settings. A native accelerator here would keep firing on the
    // default combo even after the user rebinds it.
    let item = |id: &str, english: &'static str| MenuItemBuilder::with_id(id, l(id, english));
    // The on/off items: named by what they show ("Sidebar", never "Toggle
    // Sidebar"), with the check mark saying whether it is on.
    let check = |id: &str, english: &'static str| {
        CheckMenuItemBuilder::with_id(id, l(id, english))
            .checked(checked.get(id).copied().unwrap_or(false))
            .build(app)
    };
    let toggle_source_mode_item = check(TOGGLE_SOURCE_MODE_ID, "Source Code Mode")?;
    let toggle_typewriter_mode_item = check(TOGGLE_TYPEWRITER_MODE_ID, "Typewriter Mode")?;
    let toggle_sidebar_item = check(TOGGLE_SIDEBAR_ID, "Sidebar")?;
    let toggle_agent_panel_item = check(TOGGLE_AGENT_PANEL_ID, "AI Panel")?;
    let toggle_split_view_item = check(TOGGLE_SPLIT_VIEW_ID, "Split View")?;
    let toggle_zen_mode_item = check(TOGGLE_ZEN_MODE_ID, "Zen Mode")?;

    // Fixed OS-convention accelerators (like Cmd+S / Cmd+W), not
    // user-configurable ones - so unlike the items above they keep
    // native accelerators. Zoom itself is applied by the frontend
    // (app/useZoom.ts), which also handles pinch and mod+wheel.
    let zoom_in_item = item(ZOOM_IN_ID, "Zoom In")
        .accelerator("CmdOrCtrl+=")
        .build(app)?;
    let zoom_out_item = item(ZOOM_OUT_ID, "Zoom Out")
        .accelerator("CmdOrCtrl+-")
        .build(app)?;
    let zoom_reset_item = item(ZOOM_RESET_ID, "Actual Size")
        .accelerator("CmdOrCtrl+0")
        .build(app)?;

    let view_menu = {
        let builder = SubmenuBuilder::new(app, l("menu:view", "View"))
            // Panels, then ways of viewing the text, then size.
            .item(&toggle_sidebar_item)
            .item(&toggle_agent_panel_item)
            .separator()
            .item(&toggle_source_mode_item)
            .item(&toggle_split_view_item)
            .item(&toggle_typewriter_mode_item)
            .item(&toggle_zen_mode_item)
            .separator()
            .item(&zoom_in_item)
            .item(&zoom_out_item)
            .item(&zoom_reset_item);
        // Same story as Hide/Show All and Bring All to Front: muda documents
        // its predefined fullscreen item as unsupported on Windows and
        // Linux, where it renders as an entry that does nothing when
        // clicked. Windows reaches fullscreen through the app-drawn menu
        // instead, which calls the window API directly
        // (src/app/app-menu-actions.ts).
        #[cfg(target_os = "macos")]
        let builder = builder
            .separator()
            .fullscreen_with_text(l("predefined:fullscreen", "Full Screen"));
        builder.build()?
    };

    // Cmd/Ctrl+Shift+N everywhere: what file managers, browsers and VS Code
    // open a window with. Cmd+T read as "new tab" to anyone coming from a
    // browser, and this app has tabs (Cmd+N opens a new document in one).
    const NEW_WINDOW_ACCEL: &str = "CmdOrCtrl+Shift+N";
    let new_window_item = item(NEW_WINDOW_ID, "New Window")
        .accelerator(NEW_WINDOW_ACCEL)
        .build(app)?;
    // Built manually (not the .close_window() predefined item) so it
    // doesn't own the OS-default Cmd+W accelerator - that's Close
    // Tab's now (see CLOSE_TAB_ID above).
    let close_window_item = item(CLOSE_WINDOW_ID, "Close Window")
        .accelerator("CmdOrCtrl+Shift+W")
        .build(app)?;

    let window_menu = {
        let builder = SubmenuBuilder::new(app, l("menu:window", "Window"))
            .item(&new_window_item)
            .separator()
            .minimize_with_text(l("predefined:minimize", "Minimize"))
            .maximize_with_text(l("predefined:maximize", "Zoom"))
            .separator()
            .item(&close_window_item);
        // Same story as Hide/Show All above: "Bring All to Front" is an
        // NSApplication command with no Windows counterpart.
        #[cfg(target_os = "macos")]
        let builder = builder
            .separator()
            .bring_all_to_front_with_text(l("predefined:bring-all-to-front", "Bring All to Front"));
        builder.build()?
    };

    let help = |doc: &str, english: &'static str| {
        let id = format!("{HELP_DOC_PREFIX}{doc}");
        let text = l(&id, english);
        (id, text)
    };
    let (welcome_id, welcome) = help("welcome", "Welcome and Tutorial");
    let (markdown_id, markdown) = help("markdown", "Markdown Guide");
    let (agent_id, agent) = help("agent", "AI Features Guide");
    let help_menu = SubmenuBuilder::new(app, l("menu:help", "Help"))
        .text(welcome_id, welcome)
        .separator()
        .text(markdown_id, markdown)
        .text(agent_id, agent)
        .text(TUTORIALS_ID, l(TUTORIALS_ID, "Video Tutorials"))
        .separator()
        .text(COMMUNITY_ID, l(COMMUNITY_ID, "Join the Community"))
        .build()?;

    // Filled by rebuild_plugin_menu, from what the plugins that are on add.
    let plugins_menu = SubmenuBuilder::new(app, l("menu:plugins", "Plugins")).build()?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &format_menu,
            &view_menu,
            &plugins_menu,
            &window_menu,
            &help_menu,
        ])
        .build()?;
    let check_items = vec![
        toggle_sidebar_item,
        toggle_agent_panel_item,
        toggle_source_mode_item,
        toggle_split_view_item,
        toggle_typewriter_mode_item,
        toggle_zen_mode_item,
    ];
    Ok(BuiltMenu {
        menu,
        open_recent: open_recent_menu,
        plugins: plugins_menu,
        check_items,
    })
}
