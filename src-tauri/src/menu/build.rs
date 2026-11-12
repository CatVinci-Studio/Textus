//! The native menu bar, built from the menu table (table.rs).

use super::table::{here, named, Item, Node, PLATFORM, TABLE};
use super::*;
use tauri::menu::IsMenuItem;

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
    #[cfg(target_os = "macos")]
    super::dock::install(app.handle());
    Ok(())
}

/// Builds the menu bar with `labels` and makes it the app's, Open Recent filled
/// from the persisted list.
pub(crate) fn set_menu(app: &AppHandle, labels: &HashMap<String, String>) -> tauri::Result<()> {
    let checked = app.state::<ViewChecks>().0.lock().unwrap().checked.clone();
    let accelerators = app.state::<MenuAccelerators>().0.lock().unwrap().clone();
    let built = build(app, labels, &checked, &accelerators)?;
    app.set_menu(built.menu)?;
    *app.state::<RecentMenu>().0.lock().unwrap() = Some(built.open_recent);
    app.state::<ViewChecks>().0.lock().unwrap().items = built.check_items;
    *app.state::<PluginMenu>().submenu.lock().unwrap() = built.plugins;
    rebuild_recent_menu(app);
    rebuild_plugin_menu(app);
    Ok(())
}

/// What building collects on the way: the submenus filled later and the
/// View menu's on/off items.
struct Builder<'a> {
    app: &'a AppHandle,
    labels: &'a HashMap<String, String>,
    checked: &'a HashMap<String, bool>,
    /// The heading levels' keys, as Settings has them.
    accelerators: &'a HashMap<String, String>,
    open_recent: Option<Submenu<Wry>>,
    plugins: Option<Submenu<Wry>>,
    check_items: Vec<CheckMenuItem<Wry>>,
}

type Built = Box<dyn IsMenuItem<Wry>>;

impl Builder<'_> {
    fn text(&self, key: &str, english: &str) -> String {
        label(self.labels, key, &named(english))
    }

    fn submenu(&mut self, title: String, nodes: &[Node]) -> tauri::Result<Submenu<Wry>> {
        let mut children: Vec<Built> = Vec::new();
        for node in nodes {
            match node {
                Node::Line(_) => children.push(Box::new(PredefinedMenuItem::separator(self.app)?)),
                Node::Separator { on, .. } if here(on) => {
                    children.push(Box::new(PredefinedMenuItem::separator(self.app)?))
                }
                Node::Separator { .. } => {}
                Node::Menu(menu) => {
                    let title = self.text(&format!("menu:{}", menu.menu), &menu.en);
                    children.push(Box::new(self.menu(title, &menu.menu, &menu.items)?));
                }
                Node::Section { section } => self.section(section, &mut children)?,
                Node::Item(item) if here(&item.on) => children.push(self.item(item)?),
                Node::Item(_) => {}
            }
        }
        let refs: Vec<&dyn IsMenuItem<Wry>> = children.iter().map(|c| c.as_ref()).collect();
        SubmenuBuilder::new(self.app, title).items(&refs).build()
    }

    /// A submenu, kept when it is one filled after the build.
    fn menu(&mut self, title: String, name: &str, nodes: &[Node]) -> tauri::Result<Submenu<Wry>> {
        let sub = self.submenu(title, nodes)?;
        match name {
            "open-recent" => self.open_recent = Some(sub.clone()),
            "plugins" => self.plugins = Some(sub.clone()),
            _ => {}
        }
        Ok(sub)
    }

    fn item(&mut self, item: &Item) -> tauri::Result<Built> {
        let mut text = self.text(&item.label_key(), &item.en);
        if let Some(suffix) = item.suffix.as_deref() {
            if !text.ends_with(suffix) {
                text.push_str(suffix);
            }
        }
        if let Some(name) = item.predefined.as_deref() {
            if !(item.mac_own && PLATFORM == "mac") {
                return predefined(self.app, name, &text);
            }
        }
        // A macOS-own item (undo:, redo: reach WebKit's history, never the
        // editor's) runs in the focused window under its name.
        let id = item
            .id
            .clone()
            .or_else(|| item.predefined.clone())
            .unwrap_or_default();
        if item.check {
            let mut builder = CheckMenuItemBuilder::with_id(&id, text)
                .checked(self.checked.get(&id).copied().unwrap_or(false));
            if let Some(keys) = item.accelerator() {
                builder = builder.accelerator(keys);
            }
            let check = builder.build(self.app)?;
            self.check_items.push(check.clone());
            return Ok(Box::new(check));
        }
        let mut builder = MenuItemBuilder::with_id(&id, text);
        if let Some(keys) = item.accelerator() {
            builder = builder.accelerator(keys);
        }
        Ok(Box::new(builder.build(self.app)?))
    }

    /// The parts made from other lists: the heading levels and the pandoc
    /// formats. Open Recent and Plugins are filled after the build.
    fn section(&self, section: &str, out: &mut Vec<Built>) -> tauri::Result<()> {
        match section {
            "headings" => {
                for level in 1..=6 {
                    let id = format!("{INSERT_BLOCK_PREFIX}h{level}");
                    let english = table::text_en("heading").replace("{n}", &level.to_string());
                    let item =
                        MenuItemBuilder::with_id(&id, self.text(&id, &english)).build(self.app)?;
                    // Set after the build: a key muda can't read leaves the item
                    // without one, where the builder would fail the whole bar.
                    if let Some(accelerator) = self.accelerators.get(&id) {
                        let _ = item.set_accelerator(Some(accelerator));
                    }
                    out.push(Box::new(item));
                }
            }
            "pandoc" => {
                for format in crate::export_formats::pandoc_formats() {
                    let id = format!("{EXPORT_PANDOC_PREFIX}{}", format.format);
                    out.push(Box::new(
                        MenuItemBuilder::with_id(&id, self.text(&id, &format.menu))
                            .build(self.app)?,
                    ));
                }
            }
            _ => {}
        }
        Ok(())
    }
}

/// One of muda's own items by its table name.
fn predefined(app: &AppHandle, name: &str, text: &str) -> tauri::Result<Built> {
    let text = Some(text);
    let item = match name {
        "about" => PredefinedMenuItem::about(app, text, None),
        "hide" => PredefinedMenuItem::hide(app, text),
        "hide-others" => PredefinedMenuItem::hide_others(app, text),
        "show-all" => PredefinedMenuItem::show_all(app, text),
        "undo" => PredefinedMenuItem::undo(app, text),
        "redo" => PredefinedMenuItem::redo(app, text),
        "cut" => PredefinedMenuItem::cut(app, text),
        "copy" => PredefinedMenuItem::copy(app, text),
        "paste" => PredefinedMenuItem::paste(app, text),
        "select-all" => PredefinedMenuItem::select_all(app, text),
        "fullscreen" => PredefinedMenuItem::fullscreen(app, text),
        "minimize" => PredefinedMenuItem::minimize(app, text),
        "maximize" => PredefinedMenuItem::maximize(app, text),
        "bring-all-to-front" => PredefinedMenuItem::bring_all_to_front(app, text),
        _ => PredefinedMenuItem::separator(app),
    }?;
    Ok(Box::new(item))
}

/// The whole menu bar, its Open Recent submenu (built empty), the View menu's
/// on/off items, and the heading levels with the keys in `accelerators`.
pub(crate) fn build(
    app: &AppHandle,
    labels: &HashMap<String, String>,
    checked: &HashMap<String, bool>,
    accelerators: &HashMap<String, String>,
) -> tauri::Result<BuiltMenu> {
    let mut builder = Builder {
        app,
        labels,
        checked,
        accelerators,
        open_recent: None,
        plugins: None,
        check_items: Vec::new(),
    };
    let mut menus = Vec::new();
    for menu in &TABLE.bar {
        // The app menu is titled by the app's name on every platform.
        let title = if menu.menu == "app" {
            named(&menu.en)
        } else {
            builder.text(&format!("menu:{}", menu.menu), &menu.en)
        };
        menus.push(builder.menu(title, &menu.menu, &menu.items)?);
    }
    let refs: Vec<&dyn IsMenuItem<Wry>> = menus.iter().map(|m| m as &dyn IsMenuItem<Wry>).collect();
    let menu = MenuBuilder::new(app).items(&refs).build()?;
    Ok(BuiltMenu {
        menu,
        open_recent: builder.open_recent.expect("menu.json has open-recent"),
        plugins: builder.plugins,
        check_items: builder.check_items,
    })
}
