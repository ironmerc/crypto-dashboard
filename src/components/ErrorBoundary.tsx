import React, { type ErrorInfo, type ReactNode } from 'react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
    public state: State = {
        hasError: false
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
                <div className="flex items-center justify-center h-full w-full text-terminal-red border border-terminal-red p-4 rounded bg-[#ff333311]">
                    <div className="text-center">
                        <h2 className="text-xl font-bold mb-2">System Failure</h2>
                        <p className="font-mono text-sm">{this.state.error?.message || 'Component crashed'}</p>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
