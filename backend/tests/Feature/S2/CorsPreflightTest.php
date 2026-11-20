<?php

namespace Tests\Feature\S2;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class CorsPreflightTest extends TestCase
{
    use RefreshDatabase;

    public function test_frontend_preflight_allows_idempotency_and_session_headers(): void
    {
        $response = $this->browserRequest()->options('/api/v1/auth/logout', [], [
            'Access-Control-Request-Method' => 'POST',
            'Access-Control-Request-Headers' => 'content-type,x-xsrf-token,idempotency-key',
        ]);

        $response->assertNoContent()
            ->assertHeader('Access-Control-Allow-Origin', 'http://localhost:3000')
            ->assertHeader('Access-Control-Allow-Credentials', 'true');

        $allowedHeaders = array_map(
            'trim',
            explode(',', strtolower((string) $response->headers->get('Access-Control-Allow-Headers'))),
        );
        $this->assertContains('content-type', $allowedHeaders);
        $this->assertContains('x-xsrf-token', $allowedHeaders);
        $this->assertContains('idempotency-key', $allowedHeaders);
    }

    public function test_untrusted_origin_receives_no_credentialed_cors_permission(): void
    {
        $response = $this->withCredentials()->withHeaders([
            'Origin' => 'https://untrusted.example',
            'Access-Control-Request-Method' => 'POST',
            'Access-Control-Request-Headers' => 'content-type,idempotency-key',
        ])->options('/api/v1/auth/logout');

        $response->assertNoContent();
        $allowedOrigin = $response->headers->get('Access-Control-Allow-Origin');
        $this->assertSame('http://localhost:3000', $allowedOrigin);
        $this->assertNotSame('https://untrusted.example', $allowedOrigin);
    }

    public function test_unauthorized_browser_write_is_readable_from_the_allowed_origin(): void
    {
        $response = $this->browserRequest()
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/auth/logout');

        $response->assertUnauthorized()
            ->assertHeader('Access-Control-Allow-Origin', 'http://localhost:3000')
            ->assertHeader('Access-Control-Allow-Credentials', 'true');
    }

    private function browserRequest(): static
    {
        return $this->withCredentials()->withHeaders([
            'Origin' => 'http://localhost:3000',
            'Referer' => 'http://localhost:3000/',
        ]);
    }
}
