<!doctype html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Konfirmasi perubahan email HadirinAja</title>
</head>
<body>
    <p>Halo {{ $memberName }},</p>
    <p>Owner meminta perubahan email akun Anda menjadi {{ $newEmail }}.</p>
    <p><a href="{{ $confirmationUrl }}">Buka konfirmasi perubahan email</a></p>
    <p>Tautan berlaku sampai {{ $expiresAt }}. Halaman konfirmasi akan meminta Anda menekan tombol sebelum perubahan diterapkan.</p>
    <p>Jika Anda tidak mengenali permintaan ini, jangan lanjutkan dan hubungi Owner organisasi Anda.</p>
</body>
</html>
