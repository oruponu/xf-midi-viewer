import { Component } from 'react';
import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  fallback: (error: Error) => ReactNode;
  onError?: (error: Error) => void;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: toError(error) };
  }

  componentDidCatch(error: unknown) {
    this.props.onError?.(toError(error));
  }

  render() {
    if (this.state.error) return this.props.fallback(this.state.error);
    return this.props.children;
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
