<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        RateLimiter::for('auth-login', static function (Request $request): array {
            $identifier = Str::lower(trim((string) $request->input('identifier')));
            $identityKey = hash_hmac('sha256', $identifier, (string) config('app.key'));
            $ipKey = hash('sha256', (string) $request->ip());

            return [
                Limit::perMinute(30)->by('auth-login-ip:'.$ipKey),
                Limit::perMinutes(15, 5)->by('auth-login-identity:'.$identityKey.':'.$ipKey),
            ];
        });

        RateLimiter::for('kiosk-pair', static function (Request $request): array {
            $codeKey = hash('sha256', Str::upper(trim((string) $request->input('code'))));
            $ipKey = hash('sha256', (string) $request->ip());

            return [
                Limit::perMinute(10)->by('kiosk-pair-ip:'.$ipKey),
                Limit::perMinutes(15, 5)->by('kiosk-pair-code:'.$codeKey),
            ];
        });

        RateLimiter::for('kiosk-pin', static function (Request $request): array {
            $deviceKey = hash('sha256', (string) $request->cookie('hadirinaja_kiosk'));
            $ipKey = hash('sha256', (string) $request->ip());

            return [
                Limit::perMinute(30)->by('kiosk-pin-device:'.$deviceKey),
                Limit::perMinute(60)->by('kiosk-pin-ip:'.$ipKey),
            ];
        });
    }
}
