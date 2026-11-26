<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

final class EmailChangeNotice extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $memberName,
        public readonly string $oldEmail,
        public readonly string $newEmail,
        public readonly bool $requiresConfirmation,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Permintaan perubahan email akun HadirinAja');
    }

    public function content(): Content
    {
        return new Content(view: 'emails.email-change-notice');
    }
}
