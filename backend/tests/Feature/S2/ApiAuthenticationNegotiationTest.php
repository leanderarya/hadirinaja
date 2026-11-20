<?php

namespace Tests\Feature\S2;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ApiAuthenticationNegotiationTest extends TestCase
{
    use RefreshDatabase;

    public function test_unauthenticated_api_requests_always_receive_json_401_responses(): void
    {
        foreach ([null, '*/*', 'application/json', 'text/html'] as $accept) {
            $request = $accept === null
                ? $this->withoutHeader('Accept')
                : $this->withHeaders(['Accept' => $accept]);

            $response = $request->get('/api/v1/auth/me');

            $response->assertUnauthorized()
                ->assertJsonPath('message', 'Unauthenticated.')
                ->assertHeader('content-type', 'application/json');
        }
    }
}
