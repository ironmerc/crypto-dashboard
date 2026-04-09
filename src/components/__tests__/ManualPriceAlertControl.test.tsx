import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ManualPriceAlertControl } from '../ManualPriceAlertControl';

function ManualPriceAlertControlHarness() {
    const [manualAlertPrice, setManualAlertPrice] = useState('');

    return (
        <ManualPriceAlertControl
            manualAlertPrice={manualAlertPrice}
            onPriceChange={setManualAlertPrice}
            onSave={vi.fn()}
            referencePrice={100}
        />
    );
}

describe('ManualPriceAlertControl', () => {
    it('shows the inferred direction as read-only text while typing a manual alert price', () => {
        render(<ManualPriceAlertControlHarness />);

        const input = screen.getByPlaceholderText('Manual Price...');
        const direction = screen.getByLabelText(/inferred direction/i);

        expect(direction).toHaveTextContent('AUTO --');

        fireEvent.change(input, { target: { value: '105' } });
        expect(direction).toHaveTextContent('AUTO ABOVE');

        fireEvent.change(input, { target: { value: '95' } });
        expect(direction).toHaveTextContent('AUTO BELOW');

        fireEvent.change(input, { target: { value: '100' } });
        expect(direction).toHaveTextContent('AUTO CROSS');
    });
});
