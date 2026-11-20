<?php

use App\Http\Middleware\EnsureActiveTenant;
use App\Http\Middleware\EnsureKioskDevice;
use App\Http\Middleware\NoStore;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
    )
    ->withSchedule(function (Schedule $schedule): void {
        $schedule->command('planner:notifications-dispatch --limit=100')->everyMinute()->withoutOverlapping(5);
        $schedule->command('attendance:evidence-holds-expire --limit=1000')
            ->hourly()
            ->withoutOverlapping(30);
        $schedule->command('attendance:evidence-expire --limit=100')
            ->hourly()
            ->withoutOverlapping(30)
            ->when(fn (): bool => (bool) config('attendance_evidence.deletion_enabled', false));
    })
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->statefulApi();
        $middleware->redirectGuestsTo(
            fn (Request $request): ?string => $request->is('api/*') ? null : route('login'),
        );
        $middleware->alias([
            'active-tenant' => EnsureActiveTenant::class,
            'kiosk-device' => EnsureKioskDevice::class,
            'no-store' => NoStore::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
