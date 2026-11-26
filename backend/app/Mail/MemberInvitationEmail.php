<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

final class MemberInvitationEmail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $memberName,
        public readonly string $organizationName,
        public readonly string $activationUrl,
        public readonly string $expiresAt,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Undangan akses HadirinAja');
    }

    public function content(): Content
    {
        return new Content(view: 'emails.member-invitation');
    }
}
