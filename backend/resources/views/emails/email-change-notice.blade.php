<!doctype html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Pemberitahuan perubahan email HadirinAja</title>
</head>
<body>
    <p>Halo {{ $memberName }},</p>
    <p>Owner meminta perubahan email akun HadirinAja dari {{ $oldEmail }} menjadi {{ $newEmail }}.</p>
    @if ($requiresConfirmation)
        <p>Perubahan berlaku setelah Anda mengonfirmasi tautan yang dikirim ke email baru.</p>
    @else
        <p>Undangan lama untuk alamat ini sudah dicabut. Owner mengirim undangan baru ke alamat email yang diminta.</p>
    @endif
    <p>Jika Anda tidak mengenali permintaan ini, hubungi Owner organisasi Anda.</p>
</body>
</html>
