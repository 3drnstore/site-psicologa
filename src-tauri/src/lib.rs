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

        body:has(.auth-page) {
          background: #f3f6fa !important;
        }

        .auth-page {
          background:
            radial-gradient(circle at top left, #dfe9f8 0, #f3f6fa 52%, #edf2f9 100%) !important;
          color: #3f526c !important;
        }

        .auth-page .auth-card {
          background: rgba(255, 255, 255, 0.9) !important;
          border-color: #d9e3f1 !important;
          box-shadow: 0 30px 80px rgba(66, 87, 117, 0.16) !important;
        }

        .auth-page .brand-mark {
          background: #7392c6 !important;
        }

        .auth-page .auth-brand strong,
        .auth-page .auth-card h1 {
          color: #425775 !important;
        }

        .auth-page .auth-brand small,
        .auth-page .auth-card > p {
          color: #71839b !important;
        }

        .auth-page .section-kicker {
          color: #7495cb !important;
        }

        .auth-page .auth-card label {
          color: #526985 !important;
        }

        .auth-page .auth-card input {
          border-color: #cbd9eb !important;
          color: #3f526c !important;
        }

        .auth-page .auth-card input:focus {
          border-color: #7495cb !important;
          box-shadow: 0 0 0 3px rgba(116, 149, 203, 0.16) !important;
        }

        .auth-page .primary-button {
          background: #7495cb !important;
          box-shadow: 0 8px 24px rgba(75, 111, 169, 0.22) !important;
        }

        .auth-page .primary-button:hover {
          background: #6487c0 !important;
        }

        .auth-page .forgot-password-link,
        .auth-page .password-toggle-dom {
          color: #5676a8 !important;
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
