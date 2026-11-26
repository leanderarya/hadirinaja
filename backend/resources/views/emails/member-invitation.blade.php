<!doctype html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Undangan akses HadirinAja</title>
</head>
<body>
    <p>Halo {{ $memberName }},</p>
    <p>Undangan akses Anda ke {{ $organizationName }} telah diterbitkan ulang ke email ini.</p>
    <p><a href="{{ $activationUrl }}">Buka undangan HadirinAja</a></p>
    <p>Tautan berlaku sampai {{ $expiresAt }}.</p>
</body>
</html>
