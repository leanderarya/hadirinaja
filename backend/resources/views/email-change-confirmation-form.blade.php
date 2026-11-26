<!doctype html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <title>Konfirmasi perubahan email HadirinAja</title>
    <style>
        button { cursor: pointer; min-height: 44px; }
        button:hover:not(:disabled) { background: #125c49; color: #fff; }
        button:active:not(:disabled) { transform: translateY(1px); }
        button:disabled { cursor: not-allowed; }
        button:focus-visible { outline: 3px solid #146f58; outline-offset: 2px; }
    </style>
</head>
<body>
    <main>
        <h1>Konfirmasi perubahan email</h1>
        <p id="email-change-status" role="status" aria-live="polite">Memeriksa tautan konfirmasi.</p>
        <p id="email-change-summary" hidden>
            Email akun akan diubah menjadi <strong id="email-change-address"></strong>.
            Sesi akun yang masih aktif akan diakhiri.
        </p>
        <form id="email-change-form" method="post" action="{{ $confirmationUrl }}">
            <button id="email-change-confirm" type="submit" disabled>Konfirmasi perubahan email</button>
        </form>
    </main>
    <script>
        const token = window.location.hash.slice(1);
        const status = document.getElementById('email-change-status');
        const summary = document.getElementById('email-change-summary');
        const address = document.getElementById('email-change-address');
        const form = document.getElementById('email-change-form');
        const button = document.getElementById('email-change-confirm');

        async function postJson(url, payload) {
            const csrfResponse = await fetch(@json(url('/sanctum/csrf-cookie')), {
                credentials: 'same-origin',
            });
            if (!csrfResponse.ok) {
                throw new Error('Tidak dapat memulai konfirmasi. Muat ulang halaman dan coba lagi.');
            }
            const csrfCookie = document.cookie.split('; ')
                .find((cookie) => cookie.startsWith('XSRF-TOKEN='));
            if (!csrfCookie) {
                throw new Error('Token keamanan tidak tersedia. Muat ulang halaman dan coba lagi.');
            }

            const response = await fetch(url, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'X-XSRF-TOKEN': decodeURIComponent(csrfCookie.slice('XSRF-TOKEN='.length)),
                },
                body: JSON.stringify(payload),
            });
            const body = await response.json();
            if (!response.ok) {
                throw new Error(body.message || 'Tautan perubahan email tidak tersedia.');
            }

            return body;
        }

        async function inspectToken() {
            if (!/^[a-f0-9]{64}$/i.test(token)) {
                throw new Error('Tautan perubahan email tidak valid.');
            }

            const pending = await postJson(@json($inspectUrl), { token });
            address.textContent = pending.email;
            summary.hidden = false;
            button.disabled = false;
            status.textContent = 'Pastikan email baru benar sebelum melanjutkan.';
        }

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            button.disabled = true;
            status.textContent = 'Menerapkan perubahan email.';

            try {
                await postJson(@json($confirmationUrl), { token });
                summary.hidden = true;
                status.textContent = 'Alamat email berhasil diperbarui. Silakan masuk kembali dengan email baru.';
            } catch (error) {
                status.textContent = error.message;
                button.disabled = false;
            }
        });

        inspectToken().catch((error) => {
            status.textContent = error.message;
        });
    </script>
</body>
</html>
