<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class HealthApiTest extends TestCase
{
    public function test_health_endpoint_reports_database_available_when_query_succeeds(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->with('SELECT 1')
            ->andReturn((object) ['1' => 1]);

        $this->getJson('/api/v1/health')
            ->assertOk()
            ->assertExactJson([
                'status' => 'healthy',
                'checks' => ['database' => 'available'],
            ]);
    }

    public function test_health_endpoint_returns_safe_unavailable_response_when_query_fails(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->with('SELECT 1')
            ->andThrow(new \RuntimeException('database driver details'));

        $this->getJson('/api/v1/health')
            ->assertServiceUnavailable()
            ->assertExactJson([
                'status' => 'unhealthy',
                'checks' => ['database' => 'unavailable'],
            ])
            ->assertDontSee('database driver details');
    }

    public function test_health_endpoint_works_against_the_isolated_mysql_test_database(): void
    {
        $this->getJson('/api/v1/health')
            ->assertOk()
            ->assertExactJson([
                'status' => 'healthy',
                'checks' => ['database' => 'available'],
            ]);
    }

    public function test_no_public_domain_management_routes_are_registered(): void
    {
        $apiRoutes = collect(Route::getRoutes()->getRoutes())
            ->filter(fn ($route) => str_starts_with($route->uri(), 'api/'))
            ->map(fn ($route) => $route->uri())
            ->unique()->sort()->values()->all();

        $this->assertSame(['api/v1/health'], $apiRoutes);
    }
}
