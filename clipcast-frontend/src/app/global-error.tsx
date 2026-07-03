"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Root-level boundary: renders its own <html>, so keep it dependency-free.
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100svh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          background: "#17151f",
          color: "#f2f0eb",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "28px" }}>
          Clip<span style={{ color: "#ff7847" }}>Cast</span> hit a snag
        </h1>
        <p style={{ margin: 0, maxWidth: "420px", color: "#b7b3c4" }}>
          A critical error occurred. Please try again — if the problem
          persists, check your internet connection.
        </p>
        <button
          onClick={reset}
          style={{
            padding: "10px 24px",
            borderRadius: "12px",
            border: "none",
            background: "#ff7847",
            color: "#17151f",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
