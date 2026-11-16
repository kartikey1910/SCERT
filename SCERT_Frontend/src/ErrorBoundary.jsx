import { Component } from 'react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('UI ErrorBoundary caught error:', error, info);
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div className="applications-view">
          <div className="error-state">
            {error?.message || String(error)}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
