import type { SaveSystem } from '../game/SaveSystem';

export class AuthScreen {
  private el: HTMLElement;
  private saveSystem: SaveSystem;
  private activeTab: 'login' | 'register' = 'login';
  private onSuccess: (() => void) | null = null;

  constructor(saveSystem: SaveSystem) {
    this.saveSystem = saveSystem;
    this.el = document.getElementById('auth-screen')!;
    this.bind();
  }

  setOnSuccess(cb: () => void) { this.onSuccess = cb; }

  show() { this.el.classList.remove('hidden'); }
  hide() { this.el.classList.add('hidden'); }

  private bind() {
    // Tab switching
    this.el.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const t = (tab as HTMLElement).dataset.tab as 'login' | 'register';
        this.switchTab(t);
      });
    });

    // Login form
    const loginForm = this.el.querySelector('#login-form') as HTMLFormElement;
    loginForm.addEventListener('submit', e => {
      e.preventDefault();
      this.handleLogin();
    });

    // Register form
    const regForm = this.el.querySelector('#register-form') as HTMLFormElement;
    regForm.addEventListener('submit', e => {
      e.preventDefault();
      this.handleRegister();
    });

    // Password strength meter
    const regPassword = this.el.querySelector('#reg-password') as HTMLInputElement;
    regPassword.addEventListener('input', () => this.updatePasswordStrength(regPassword.value));

    // Guest play
    const guestBtn = this.el.querySelector('#guest-btn') as HTMLButtonElement;
    guestBtn.addEventListener('click', () => this.handleGuest());
  }

  private switchTab(tab: 'login' | 'register') {
    this.activeTab = tab;
    this.el.querySelectorAll('.auth-tab').forEach(t => {
      (t as HTMLElement).classList.toggle('active', (t as HTMLElement).dataset.tab === tab);
    });
    this.el.querySelectorAll('.auth-form').forEach(f => {
      (f as HTMLElement).classList.toggle('hidden', (f as HTMLElement).id !== `${tab}-form`);
    });
    this.clearError();
  }

  private handleLogin() {
    const user = (this.el.querySelector('#login-user') as HTMLInputElement).value.trim();
    const pass = (this.el.querySelector('#login-pass') as HTMLInputElement).value;
    const rem  = (this.el.querySelector('#login-remember') as HTMLInputElement).checked;

    const result = this.saveSystem.login(user, pass, rem);
    if (result.ok) {
      this.showSuccess('¡Bienvenido de vuelta!');
      setTimeout(() => this.onSuccess?.(), 800);
    } else {
      this.showError(result.error ?? 'Error al iniciar sesión');
    }
  }

  private handleRegister() {
    const user  = (this.el.querySelector('#reg-user') as HTMLInputElement).value.trim();
    const pass  = (this.el.querySelector('#reg-password') as HTMLInputElement).value;
    const pass2 = (this.el.querySelector('#reg-password2') as HTMLInputElement).value;

    if (pass !== pass2) {
      this.showError('Las contraseñas no coinciden');
      return;
    }

    const regResult = this.saveSystem.register(user, pass);
    if (!regResult.ok) {
      this.showError(regResult.error ?? 'Error al registrarse');
      return;
    }

    const loginResult = this.saveSystem.login(user, pass, false);
    if (loginResult.ok) {
      this.showSuccess(`¡Cuenta creada! Bienvenido, ${user}`);
      setTimeout(() => this.onSuccess?.(), 900);
    }
  }

  private handleGuest() {
    const guestName = `Invitado_${Math.floor(Math.random() * 9999)}`;
    this.saveSystem.register(guestName, 'guest_' + Math.random().toString(36).slice(2), );
    this.saveSystem.login(guestName, 'guest_' + Math.random().toString(36).slice(2), false);
    // Just log in as guest without password check
    (this.saveSystem as any).session = {
      username: guestName,
      civType: 'AZTEC',
      loginTime: Date.now(),
      remember: false,
    };
    this.showSuccess('Entrando como invitado...');
    setTimeout(() => this.onSuccess?.(), 700);
  }

  private updatePasswordStrength(password: string) {
    const bar  = this.el.querySelector('#strength-bar') as HTMLElement;
    const text = this.el.querySelector('#strength-text') as HTMLElement;
    if (!bar || !text) return;

    let score = 0;
    if (password.length >= 4)  score++;
    if (password.length >= 8)  score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    const labels = ['Muy débil', 'Débil', 'Regular', 'Buena', 'Fuerte', 'Muy fuerte'];
    const colors = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#27ae60', '#1abc9c'];

    bar.style.width = `${(score / 5) * 100}%`;
    bar.style.background = colors[score] ?? colors[0];
    text.textContent = labels[score] ?? labels[0];
    text.style.color  = colors[score] ?? colors[0];
  }

  private showError(msg: string) {
    const el = this.el.querySelector('.auth-message') as HTMLElement;
    if (!el) return;
    el.textContent = msg;
    el.className = 'auth-message error';
    el.classList.remove('hidden');
  }

  private showSuccess(msg: string) {
    const el = this.el.querySelector('.auth-message') as HTMLElement;
    if (!el) return;
    el.textContent = msg;
    el.className = 'auth-message success';
    el.classList.remove('hidden');
  }

  private clearError() {
    const el = this.el.querySelector('.auth-message') as HTMLElement;
    if (el) el.classList.add('hidden');
  }
}
