(function () {
    function closeMenus(exceptMenu) {
        document.querySelectorAll('[data-header-menu]').forEach((menu) => {
            if (menu !== exceptMenu) menu.classList.add('hidden');
        });
    }

    function toggleMenu(menuId) {
        const menu = document.getElementById(menuId);
        if (!menu) return;

        const willOpen = menu.classList.contains('hidden');
        closeMenus(menu);
        menu.classList.toggle('hidden', !willOpen);
    }

    async function logout() {
        try {
            await fetch('/api/logout', {
                method: 'POST',
                credentials: 'same-origin'
            });
        } finally {
            window.location.href = '/index.html';
        }
    }

    async function loadProfile() {
        const nameElement = document.getElementById('headerProfileName');
        const emailElement = document.getElementById('headerProfileEmail');
        if (!nameElement && !emailElement) return;

        try {
            const response = await fetch('/api/me', { credentials: 'same-origin' });
            const payload = await response.json();
            if (!response.ok || !payload.success) throw new Error('Not signed in');

            if (nameElement) nameElement.textContent = payload.user.name || 'Incident Commander';
            if (emailElement) emailElement.textContent = payload.user.email || '';
        } catch {
            if (nameElement) nameElement.textContent = 'Guest';
            if (emailElement) emailElement.textContent = 'Not signed in';
        }
    }

    function wireHeaderActions() {
        document.querySelectorAll('[data-header-toggle]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                toggleMenu(button.dataset.headerToggle);
            });
        });

        document.querySelectorAll('[data-header-close]').forEach((button) => {
            button.addEventListener('click', () => closeMenus());
        });

        const logoutButton = document.querySelector('[data-header-logout]');
        if (logoutButton) {
            logoutButton.addEventListener('click', logout);
        }

        document.addEventListener('click', () => closeMenus());
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeMenus();
        });

        document.querySelectorAll('[data-header-menu]').forEach((menu) => {
            menu.addEventListener('click', (event) => event.stopPropagation());
        });

        loadProfile();
    }

    window.addEventListener('DOMContentLoaded', wireHeaderActions);
})();
