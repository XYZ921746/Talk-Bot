import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

/** 错误边界：渲染出错时显示提示而非白屏 */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 48, fontFamily: 'sans-serif', textAlign: 'center' }}>
          <h3 style={{ marginBottom: 12 }}>😵 页面出错了</h3>
          <p style={{ fontSize: 13, color: '#666', wordBreak: 'break-all' }}>
            {String(this.state.error.message || this.state.error)}
          </p>
          <button
            style={{
              marginTop: 16,
              padding: '10px 22px',
              borderRadius: 10,
              border: 'none',
              background: '#2f9dff',
              color: '#fff',
              fontSize: 14,
              cursor: 'pointer',
            }}
            onClick={() => location.reload()}
          >
            刷新重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
