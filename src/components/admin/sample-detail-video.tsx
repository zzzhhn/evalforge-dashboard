"use client";

export function SampleDetailVideo({ url }: { url: string }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-black">
      <video
        src={url}
        controls
        className="mx-auto max-h-[400px] w-full object-contain"
      />
    </div>
  );
}
