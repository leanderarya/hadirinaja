<?php

namespace App\Services;

use App\Data\PreparedAttendanceEvidence;
use App\Models\AttendanceEvidence;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use RuntimeException;

final class AttendanceEvidenceStorage
{
    private const DISK = 'local';

    public function prepare(UploadedFile $upload, int $tenantId): PreparedAttendanceEvidence
    {
        $this->cleanStaleStagingFiles();

        $source = file_get_contents($upload->getRealPath());
        $sourceMime = $upload->getMimeType() ?: 'application/octet-stream';
        $image = is_string($source) ? @imagecreatefromstring($source) : false;

        if (! $image instanceof \GdImage) {
            throw ValidationException::withMessages(['photo' => 'Foto tidak dapat dibaca sebagai gambar yang valid.']);
        }

        $width = imagesx($image);
        $height = imagesy($image);

        if ($width < 320 || $height < 240 || $width > 1920 || $height > 1920) {
            imagedestroy($image);
            throw ValidationException::withMessages(['photo' => 'Ukuran foto harus antara 320×240 dan 1920×1920 piksel.']);
        }

        $normalized = imagecreatetruecolor($width, $height);
        if (! $normalized instanceof \GdImage) {
            imagedestroy($image);
            throw new RuntimeException('Could not allocate a normalized attendance image.');
        }
        $white = imagecolorallocate($normalized, 255, 255, 255);
        imagefill($normalized, 0, 0, $white);
        imagecopy($normalized, $image, 0, 0, 0, 0, $width, $height);
        imagedestroy($image);

        ob_start();
        $encoded = imagejpeg($normalized, null, 85);
        $bytes = ob_get_clean();
        imagedestroy($normalized);

        if (! $encoded || ! is_string($bytes) || strlen($bytes) < 1024 || strlen($bytes) > 5 * 1024 * 1024) {
            throw ValidationException::withMessages(['photo' => 'Foto tidak dapat diproses atau melebihi batas ukuran.']);
        }

        $uuid = (string) Str::uuid();
        $temporaryPath = 'attendance-evidence/.staging/'.$uuid.'.jpg';
        $storagePath = 'attendance-evidence/'.$tenantId.'/'.$uuid.'.jpg';
        $disk = Storage::disk(self::DISK);

        if (! $disk->put($temporaryPath, $bytes)) {
            throw new RuntimeException('Could not stage private attendance evidence.');
        }

        return new PreparedAttendanceEvidence(
            temporaryPath: $temporaryPath,
            storagePath: $storagePath,
            detectedMimeType: $sourceMime,
            storedSizeBytes: strlen($bytes),
            width: $width,
            height: $height,
            sha256: hash('sha256', $bytes),
        );
    }

    public function commit(PreparedAttendanceEvidence $evidence): void
    {
        $disk = Storage::disk(self::DISK);

        if ($disk->exists($evidence->storagePath)) {
            return;
        }

        if (! $disk->exists($evidence->temporaryPath) || ! $disk->move($evidence->temporaryPath, $evidence->storagePath)) {
            throw new RuntimeException('Could not commit private attendance evidence.');
        }
    }

    public function cleanup(PreparedAttendanceEvidence $evidence): void
    {
        $disk = Storage::disk(self::DISK);
        $disk->delete($evidence->temporaryPath);

        try {
            $referenced = AttendanceEvidence::query()->where('storage_path', $evidence->storagePath)->exists();
        } catch (\Throwable) {
            return;
        }

        if (! $referenced) {
            $disk->delete($evidence->storagePath);
        }
    }

    public function stream(string $storagePath): ?string
    {
        $disk = Storage::disk(self::DISK);

        return $disk->exists($storagePath) ? $disk->path($storagePath) : null;
    }

    private function cleanStaleStagingFiles(): void
    {
        $disk = Storage::disk(self::DISK);
        $cutoff = now()->subHour()->getTimestamp();

        foreach ($disk->files('attendance-evidence/.staging') as $path) {
            try {
                if ($disk->lastModified($path) < $cutoff) {
                    $disk->delete($path);
                }
            } catch (\Throwable) {
                // A cleanup failure must not prevent a new valid attendance attempt.
            }
        }
    }
}
