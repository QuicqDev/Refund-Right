import { Store } from './store.ts';
import { config } from './config.ts';
import { seed } from './fixtures.ts';
import { PayPalSandbox } from './providers.ts';
import { Workflow } from './workflow.ts';
import { CheckoutService } from './checkout.ts';
import { GeminiBudget } from './budget.ts';
export function runtime() {
  const store = new Store(config.dataPath); seed(store);
  const paypal = new PayPalSandbox(config.paypalClientId, config.paypalSecret, config.merchantId, fetch, config.webOrigin);
  const budget = new GeminiBudget(new Store(config.geminiBudgetPath), config.geminiBudgetUsd);
  return { store, workflow: new Workflow(store, paypal, undefined, budget), checkout: new CheckoutService(store, paypal) };
}
