<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

final class EmailChangeConfirmation extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $memberName,
        public readonly string $newEmail,
        public readonly string $confirmationUrl,
        public readonly string $expiresAt,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Konfirmasi perubahan email HadirinAja');
    }

    public function content(): Content
    {
        return new Content(view: 'emails.email-change-confirmation');
    }
}
