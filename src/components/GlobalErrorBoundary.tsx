import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
    }

    public render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-[#0a0a0a] text-[#00ff41] font-mono p-10 flex flex-col items-center justify-center">
                    <div className="max-w-2xl w-full border border-[#333333] bg-[#111111] p-8 rounded-lg shadow-2xl">
                        <h1 className="text-2xl font-bold mb-4 border-b border-[#333333] pb-2 text-[#ff3333]">
                            SYSTEM_CRITICAL_ERROR
                        </h1>
                        <p className="mb-6 text-[#808080]">
                            The user interface has encountered an unhandled exception.
                            This is usually caused by an unexpected state or a network failure.
                        </p>
                        <div className="bg-[#050505] p-4 rounded border border-[#222222] mb-6 overflow-auto max-h-60">
                            <pre className="text-xs text-[#ff3333]">
                                {this.state.error?.toString()}
                            </pre>
                        </div>
                        <div className="flex gap-4">
                            <button
                                onClick={() => window.location.reload()}
                                className="px-4 py-2 bg-[#333333] hover:bg-[#444444] text-white rounded transition-colors text-sm uppercase font-bold"
                            >
                                Reboot Interface
                            </button>
                            <button
                                onClick={() => window.location.href = '/'}
                                className="px-4 py-2 border border-[#333333] hover:border-[#00ff41] text-[#808080] hover:text-[#00ff41] rounded transition-colors text-sm uppercase font-bold"
                            >
                                Return Home
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
