import { inferManualPriceAlertDirection } from '../store/priceAlerts';

interface ManualPriceAlertControlProps {
    manualAlertPrice: string;
    onPriceChange: (value: string) => void;
    onSave: () => void;
    referencePrice?: number | null;
}

export function ManualPriceAlertControl({
    manualAlertPrice,
    onPriceChange,
    onSave,
    referencePrice,
}: ManualPriceAlertControlProps) {
    const inferredDirection = inferManualPriceAlertDirection(manualAlertPrice, referencePrice);
    const directionLabel = inferredDirection ?? '--';

    return (
        <div className="flex items-center gap-2 px-1">
            <input
                type="text"
                placeholder="Manual Price..."
                value={manualAlertPrice}
                onChange={(e) => onPriceChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onSave()}
                className="bg-transparent border-none outline-none text-terminal-fg font-mono text-[10px] w-24 placeholder:text-terminal-muted/40"
            />
            <span
                aria-label="Inferred direction"
                className="rounded border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-[9px] font-bold text-purple-200"
            >
                AUTO {directionLabel}
            </span>
            {manualAlertPrice && (
                <button
                    onClick={onSave}
                    className="bg-purple-500/30 hover:bg-purple-500/50 text-purple-200 px-1.5 py-0.5 rounded text-[9px] font-bold transition-colors"
                >
                    SAVE
                </button>
            )}
        </div>
    );
}
