"use client";

import { Component, type ReactNode } from "react";
import Link from "next/link";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * 全局错误边界：捕获子组件渲染错误，防止白屏
 * 提供重试按钮让用户恢复
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
          <div className="text-center space-y-4 max-w-sm">
            <div className="w-16 h-16 mx-auto rounded-full bg-red-100 flex items-center justify-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">页面出错了</h2>
              <p className="text-sm text-gray-500 mt-1">
                {this.state.error?.message || "发生了未知错误"}
              </p>
            </div>
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleRetry}
                className="px-5 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                重试
              </button>
              <Link
                href="/"
                className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
              >
                返回首页
              </Link>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
