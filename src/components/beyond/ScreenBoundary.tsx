import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * One screen failing to render must not take the whole app with it. The
 * boundary shows what broke and a way back; the sidebar stays usable.
 */
export default class ScreenBoundary extends Component<{ children: ReactNode; name?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[screen]', this.props.name || 'obrazovka', error, info.componentStack);
  }

  componentDidUpdate(prev: { children: ReactNode }) {
    if (prev.children !== this.props.children && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="bb-vel">
        <div className="bb-vel__in">
          <h1 className="bb-vel__title">Tahle obrazovka spadla</h1>
          <p className="bb-vel__sub">{this.state.error.message}</p>
          <div>
            <button type="button" className="bb-pill" onClick={() => this.setState({ error: null })}>Zkusit znovu</button>
          </div>
        </div>
      </div>
    );
  }
}
