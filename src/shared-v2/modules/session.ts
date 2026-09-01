// Control panel > Session -- SRS FR-3. See docs/control-panel-data-binding.md
// §2 for the full narrative spec of on_player_select(); this is the direct
// implementation, preserving its documented always-true guards verbatim
// (they are not bugs to "fix" -- the table in that doc describes what
// actually runs, and this code must match it exactly for equivalence).

import { state } from './state';
import { initSunapiManager } from './device';
import { createEl } from './helpers';

// FR-3.1: #player_list_div starts empty in window.html -- the original
// creates its <label>+<select id="player_list"> here, once, before
// anything else references #player_list (playerEvents.ts's option-append,
// setupSession() below, and onPlayerSelect() itself all assume it already
// exists). Must run before both -- see window.ts's call order. "Plyaer
// List: " typo preserved verbatim (user-visible legacy text, not a bug).
export function createPlayerListSelect(): void {
  document.getElementById('player_list_div')!.append(
    createEl('label', {
      id: 'player_list_label',
      text: 'Plyaer List: ',
      for: 'player_list',
      style: 'margin-right: 5px;',
    }),
  );
  const playerListSelect = createEl('select', { id: 'player_list' });
  playerListSelect.addEventListener('change', onPlayerSelect);
  document.getElementById('player_list_div')!.append(playerListSelect);
}

export function onPlayerSelect(): void {
  try {
    state.selectedPlayerId = (document.getElementById('player_list') as HTMLSelectElement).value;
    console.log('Selected Player:', state.selectedPlayerId);

    const player = state.getSelectedPlayer();

    if (!player.username || !player.password) {
      (document.getElementById('user') as HTMLElement).style.display = 'block';
    } else {
      (document.getElementById('user') as HTMLElement).style.display = 'none';
      if ((document.getElementById('use_sunapi_client_checkbox') as HTMLInputElement).checked === true) {
        initSunapiManager();
      }
    }

    if (typeof player.username !== 'undefined' || player.username == null || player.username === '') {
      (document.getElementById('username') as HTMLInputElement).value = player.username;
    }
    if (typeof player.password !== 'undefined' || player.password == null || player.password === '') {
      (document.getElementById('password') as HTMLInputElement).value = player.password;
    }

    (document.getElementById('channel') as HTMLInputElement).value = player.channel;

    if (typeof player.statistics !== 'undefined' || player.statistics == null || (player.statistics as any) === '') {
      (document.getElementById('statistics') as HTMLInputElement).checked = player.statistics;
    }

    if (
      typeof player.device !== 'undefined' || player.device === '' || player.device == null ||
      player.hostname === '' || typeof player.hostname !== 'undefined' || player.hostname == null ||
      player.channel === '' || typeof player.channel !== 'undefined' || player.channel == null ||
      player.port === '' || typeof player.port !== 'undefined' || player.port == null ||
      player.profile_number === '' || typeof player.profile_number !== 'undefined' || player.profile_number == null ||
      player.profile === '' || typeof player.profile !== 'undefined' || player.profile == null
    ) {
      (document.getElementById('device') as HTMLElement).style.display = 'block';

      if (player.device === 'nvr') {
        (document.getElementById('device_type') as HTMLSelectElement).selectedIndex = 1;
      } else {
        (document.getElementById('device_type') as HTMLSelectElement).selectedIndex = 0;
      }

      if (typeof player.hostname !== 'undefined' || player.hostname == null || player.hostname === '') {
        (document.getElementById('hostname') as HTMLInputElement).value = player.hostname;
      }
      if (typeof player.port !== 'undefined' || player.port == null || player.port === '') {
        (document.getElementById('port') as HTMLInputElement).value = player.port;
      }
      if (typeof player.channel !== 'undefined' || player.channel == null || player.channel === '') {
        (document.getElementById('channel') as HTMLInputElement).value = player.channel;
      }
      if (typeof player.profile_number !== 'undefined' || player.profile_number == null || player.profile_number === '') {
        (document.getElementById('profile') as HTMLInputElement).value = player.profile_number;
      }
      if (typeof player.profile !== 'undefined' || player.profile == null || player.profile === '') {
        (document.getElementById('profile') as HTMLInputElement).value = player.profile;
      }

      // #usegmttime has no corresponding element in window.html -- guarded
      // the same way as #broadcast (see toolbar.ts), a preserved dead
      // reference, not a crash.
      const usegmttime = document.getElementById('usegmttime') as HTMLInputElement | null;
      if ((typeof player.GMT !== 'undefined' || player.GMT == null || player.GMT === '') && usegmttime !== null) {
        usegmttime.value = player.GMT + 12;
      }
    } else {
      (document.getElementById('device') as HTMLElement).style.display = 'none';
      if ((document.getElementById('use_sunapi_client_checkbox') as HTMLInputElement).checked === true) {
        initSunapiManager();
      }
    }

    if (typeof player.sunapiClient !== 'undefined' || player.sunapiClient == null) {
      (document.getElementById('play_button') as HTMLButtonElement).disabled = false;
      (document.getElementById('stop_button') as HTMLButtonElement).disabled = true;
      (document.getElementById('pause_button') as HTMLButtonElement).disabled = true;
      (document.getElementById('resume_button') as HTMLButtonElement).disabled = true;
    }
  } catch (error) {
    console.log('error' + error);
  }
}

export function setupSession(): void {
  // No player_list 'change' listener here -- createPlayerListSelect()
  // already attached the one and only listener at creation time, matching
  // the original exactly (see that function's own comment).

  document.getElementById('username')!.addEventListener('change', function (this: HTMLInputElement) {
    try {
      if (state.getSelectedPlayer() !== null) {
        const player = state.getSelectedPlayer();
        // DEVIATION (see state.ts's sunapiInitInFlight comment): only
        // re-init if the value actually changed. The original re-inits
        // on every 'change' unconditionally -- harmless for a real edit,
        // but a *native, browser-fired* 'change' also fires on blur for a
        // field the user never touched this session (e.g. clicking the
        // "Use SUNAPI" toggle right after filling this field moves focus
        // away and fires one even though nothing changed), which used to
        // mean a full second ~6-7-round-trip SUNAPI chain for free.
        const changed = player.username !== this.value;
        player.username = this.value;
        if (changed && (document.getElementById('use_sunapi_client_checkbox') as HTMLInputElement).checked === true) {
          initSunapiManager();
        }
      }
    } catch (error) {
      console.error(error);
    }
  });

  document.getElementById('password')!.addEventListener('change', function (this: HTMLInputElement) {
    try {
      if (state.getSelectedPlayer() !== null) {
        const player = state.getSelectedPlayer();
        // Same reasoning as #username's handler above.
        const changed = player.password !== this.value;
        player.password = this.value;
        if (changed && (document.getElementById('use_sunapi_client_checkbox') as HTMLInputElement).checked === true) {
          initSunapiManager();
        }
      }
    } catch (error) {
      console.error(error);
    }
  });

  (document.getElementById('statistics') as HTMLInputElement).checked = true;
  document.getElementById('statistics')!.addEventListener('change', function (this: HTMLInputElement) {
    state.getSelectedPlayer().statistics = this.checked;
  });

  setupPasswordToggle();
}

// #password starts masked (type="password"); this eye/eye-off button just
// flips it to type="text" and back -- doesn't touch state.player.password.
// Which icon shows is driven entirely by CSS off aria-pressed (see
// .password-toggle[aria-pressed="true"] in window.css) -- one source of
// truth, no separate hidden/class bookkeeping here.
function setupPasswordToggle(): void {
  const passwordInput = document.getElementById('password') as HTMLInputElement;
  const toggleButton = document.getElementById('password_toggle') as HTMLButtonElement;

  toggleButton.addEventListener('click', () => {
    const reveal = passwordInput.type === 'password';
    passwordInput.type = reveal ? 'text' : 'password';
    toggleButton.setAttribute('aria-pressed', String(reveal));
    toggleButton.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
  });
}
