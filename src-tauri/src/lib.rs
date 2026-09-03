const DESKTOP_UI_SCRIPT: &str = r#"
(() => {
  const installDesktopUi = () => {
    if (!document.getElementById('psicogestao-desktop-style')) {
      const style = document.createElement('style');
      style.id = 'psicogestao-desktop-style';
      style.textContent = `
        input[type="password"]::-ms-reveal,
        input[type="password"]::-ms-clear {
          display: none !important;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }

    if (window.location.pathname === '/admin' || window.location.pathname === '/admin/') {
      document.querySelectorAll('.back-link').forEach((element) => {
        element.style.setProperty('display', 'none', 'important');
      });
    }
  };

  installDesktopUi();
  new MutationObserver(installDesktopUi).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
"#;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .on_page_load(|webview, _payload| {
            let _ = webview.eval(DESKTOP_UI_SCRIPT);
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o PsicoGestão Desktop");
}
