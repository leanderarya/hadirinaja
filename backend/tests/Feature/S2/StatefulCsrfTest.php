<?php

namespace Tests\Feature\S2;

use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Http\Request;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Session\ArraySessionHandler;
use Illuminate\Session\Store;
use Illuminate\Session\TokenMismatchException;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful;
use Tests\TestCase;

class StatefulCsrfTest extends TestCase
{
    public function test_stateful_auth_route_uses_sanctum_and_rejects_missing_or_invalid_csrf_tokens(): void
    {
        $route = Route::getRoutes()->getByName('api.v1.auth.login');

        $this->assertInstanceOf(RoutingRoute::class, $route);
        $this->assertContains(
            EnsureFrontendRequestsAreStateful::class,
            app('router')->gatherRouteMiddleware($route),
        );

        foreach ([null, 'invalid-token'] as $providedToken) {
            $session = $this->newArraySession();
            $request = $this->crossSiteMutationRequest($session, $providedToken);
            $rejected = false;

            try {
                $this->csrfMiddleware()->handle($request, fn () => response()->noContent());
            } catch (TokenMismatchException) {
                $rejected = true;
            }

            $this->assertTrue($rejected, 'Missing or invalid CSRF tokens must be rejected.');
        }

        $session = $this->newArraySession();
        $request = $this->crossSiteMutationRequest($session, $session->token());
        $response = $this->csrfMiddleware()->handle($request, fn () => response()->noContent());

        $this->assertSame(204, $response->getStatusCode());
    }

    private function csrfMiddleware(): ValidateCsrfToken
    {
        return new class(app(), app('encrypter')) extends ValidateCsrfToken
        {
            protected function runningUnitTests(): bool
            {
                return false;
            }
        };
    }

    private function newArraySession(): Store
    {
        $session = new Store('csrf-test', new ArraySessionHandler(120));
        $session->start();
        $session->token();

        return $session;
    }

    private function crossSiteMutationRequest(Store $session, ?string $token): Request
    {
        $request = Request::create('/api/v1/auth/tenant', 'POST');
        $request->headers->set('Sec-Fetch-Site', 'cross-site');

        if ($token !== null) {
            $request->headers->set('X-CSRF-TOKEN', $token);
        }

        $request->setLaravelSession($session);

        return $request;
    }
}
