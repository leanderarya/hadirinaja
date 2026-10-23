<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class HealthApiTest extends TestCase
{
    public function test_health_endpoint_reports_database_available_when_query_succeeds(): void
    {
        config(['session.driver' => 'array']);
        DB::shouldReceive('selectOne')
            ->once()
            ->with('SELECT 1')
            ->andReturn((object) ['1' => 1]);

        $this->withHeader('Origin', 'http://health-check.invalid')->getJson('/api/v1/health')
            ->assertOk()
            ->assertExactJson([
                'status' => 'healthy',
                'checks' => ['database' => 'available'],
            ]);
    }

    public function test_health_endpoint_returns_safe_unavailable_response_when_query_fails(): void
    {
        config(['session.driver' => 'array']);
        DB::shouldReceive('selectOne')
            ->once()
            ->with('SELECT 1')
            ->andThrow(new \RuntimeException('database driver details'));

        $this->withHeader('Origin', 'http://health-check.invalid')->getJson('/api/v1/health')
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

    public function test_only_approved_authentication_and_kiosk_routes_are_public(): void
    {
        $apiRoutes = collect(Route::getRoutes()->getRoutes())
            ->filter(fn ($route) => str_starts_with($route->uri(), 'api/'))
            ->keyBy(fn ($route) => $route->uri());

        $this->assertSame([
            'api/v1/attendance/me',
            'api/v1/attendance/me/check-in',
            'api/v1/attendance/me/check-out',
            'api/v1/attendance/me/effective',
            'api/v1/attendance/me/operations/{operation}/{key}',
            'api/v1/attendance/me/requests',
            'api/v1/attendance/me/requests/{approvalRequest}/cancel',
            'api/v1/auth/login',
            'api/v1/auth/logout',
            'api/v1/auth/me',
            'api/v1/auth/tenant',
            'api/v1/auth/tenants',
            'api/v1/health',
            'api/v1/kiosk/attendance/check-in',
            'api/v1/kiosk/attendance/check-out',
            'api/v1/kiosk/attendance/employees',
            'api/v1/kiosk/attendance/next-operation',
            'api/v1/kiosk/attendance/operations/{operation}/{key}',
            'api/v1/kiosk/pair',
            'api/v1/kiosk/pin/enroll',
            'api/v1/kiosk/pin/verify',
            'api/v1/kiosk/status',
            'api/v1/management/approvals',
            'api/v1/management/approvals/{approvalRequest}',
            'api/v1/management/approvals/{approvalRequest}/decision',
            'api/v1/management/attendance',
            'api/v1/management/attendance/effective',
            'api/v1/management/attendance/events/{event}/evidence',
            'api/v1/management/attendance/finalizations',
            'api/v1/management/attendance/reviews/discover',
            'api/v1/management/attendance/sessions/{session}/corrections',
            'api/v1/management/business-units',
            'api/v1/management/employees',
            'api/v1/management/employees/{employee}',
            'api/v1/management/employees/{employee}/pin-enrollment',
            'api/v1/management/kiosks',
            'api/v1/management/kiosks/pairing-codes',
            'api/v1/management/kiosks/{device}/revoke',
            'api/v1/management/organization',
            'api/v1/management/outlets',
            'api/v1/management/reports/approvals',
            'api/v1/management/reports/attendance',
            'api/v1/management/reports/attendance.csv',
            'api/v1/management/reports/audit',
            'api/v1/management/reports/audit/{source}/{entry}',
            'api/v1/management/reports/dashboard',
            'api/v1/management/reports/filters',
            'api/v1/management/scheduling/calendar',
            'api/v1/management/scheduling/calendar/exceptions',
            'api/v1/management/scheduling/calendar/versions',
            'api/v1/management/scheduling/context',
            'api/v1/management/scheduling/exceptions',
            'api/v1/management/scheduling/holidays',
            'api/v1/management/scheduling/me/week',
            'api/v1/management/scheduling/outlets/{outlet}/policy',
            'api/v1/management/scheduling/policies',
            'api/v1/management/scheduling/policies/tenant',
            'api/v1/management/scheduling/resolve',
            'api/v1/management/scheduling/shifts',
            'api/v1/management/scheduling/shifts/{template}/versions',
            'api/v1/management/scheduling/week',
            'api/v1/management/scheduling/weekly-rules',
        ], $apiRoutes->keys()->sort()->values()->all());

        foreach ($apiRoutes->filter(fn ($route, $uri) => str_starts_with($uri, 'api/v1/management/')) as $route) {
            $this->assertContains('auth:sanctum', $route->middleware());
            $this->assertContains('active-tenant', $route->middleware());
        }

        foreach ([
            'api/v1/kiosk/attendance/check-in',
            'api/v1/kiosk/attendance/check-out',
            'api/v1/kiosk/attendance/employees',
            'api/v1/kiosk/attendance/next-operation',
            'api/v1/kiosk/attendance/operations/{operation}/{key}',
            'api/v1/kiosk/pin/enroll',
            'api/v1/kiosk/pin/verify',
            'api/v1/kiosk/status',
        ] as $uri) {
            $this->assertContains('kiosk-device', $apiRoutes->get($uri)->middleware());
        }

        foreach ([
            'api/v1/kiosk/attendance/check-in',
            'api/v1/kiosk/attendance/check-out',
            'api/v1/kiosk/attendance/next-operation',
            'api/v1/kiosk/pin/enroll',
            'api/v1/kiosk/pin/verify',
        ] as $uri) {
            $this->assertContains('throttle:kiosk-pin', $apiRoutes->get($uri)->middleware());
        }

        foreach ([
            'api/v1/attendance/me',
            'api/v1/attendance/me/check-in',
            'api/v1/attendance/me/check-out',
            'api/v1/attendance/me/effective',
            'api/v1/attendance/me/operations/{operation}/{key}',
            'api/v1/attendance/me/requests',
            'api/v1/attendance/me/requests/{approvalRequest}/cancel',
        ] as $uri) {
            $middleware = $apiRoutes->get($uri)->middleware();
            $this->assertContains('auth:sanctum', $middleware);
            $this->assertContains('active-tenant', $middleware);
        }

        $this->assertContains('throttle:auth-login', $apiRoutes->get('api/v1/auth/login')->middleware());
        $this->assertContains('throttle:kiosk-pair', $apiRoutes->get('api/v1/kiosk/pair')->middleware());
    }
}
