import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryState {
  error: Error | null;
  info: string | null;
}

/**
 * Last-resort error boundary: an uncaught render error must never leave the
 * user with a silent blank screen. Shows the error so failures are visible
 * (and reportable) instead of invisible.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info: info.componentStack ?? null });
    // Also surface in the console for anyone with devtools open.
    console.error('[mahyar-gap] render crash:', error, info.componentStack);
  }

  render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        dir="ltr"
        style={{
          padding: 24,
          fontFamily: 'monospace',
          background: '#14161f',
          color: '#ff6b6b',
          minHeight: '100vh',
          whiteSpace: 'pre-wrap',
          overflow: 'auto',
          fontSize: 13,
        }}
      >
        <h2 style={{ color: '#e7e9f0' }}>Mahyar Gap — runtime error</h2>
        <p>{error.message}</p>
        {info && <pre>{info}</pre>}
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ marginTop: 12, padding: '8px 16px', cursor: 'pointer' }}
        >
          Reload
        </button>
      </div>
    );
  }
}
