# Spec: Checkout Pix

<objective>
O cliente da loja consegue pagar um pedido com Pix no checkout web e vê a confirmação com o QR e o valor certos.
</objective>

## Contract: checkout-pix
- **Repo**: loja
- **Screens**: `home`
- **Behavior**: No checkout, o cliente escolhe Pix. A loja pede um QR ao backend (`POST /checkout/pix`) e mostra o código, o valor e o prazo. O pedido fica `awaiting_pix` até o webhook de pagamento.
- **Acceptance**:
  - [ ] `POST /checkout/pix` devolve 200 com `{ qrCode, amount, expiresAt }` para um carrinho válido
  - [ ] A tela de checkout mostra o QR, o valor em reais e o prazo de expiração
  - [ ] Pedido entra em `awaiting_pix` e não é marcado pago antes do webhook
- **Non-goals**: boleto, cartão e Pix copia-e-cola fora deste fluxo

## Contract: confirmacao
- **Repo**: loja
- **Screens**: `home`
- **Behavior**: Depois do webhook de pagamento aprovado, o checkout troca para a confirmação com número do pedido e valor pago. Recarregar a página mostra o mesmo estado.
- **Acceptance**:
  - [ ] Webhook aprovado muda o pedido para `paid` e a tela de confirmação aparece sem o cliente clicar de novo
  - [ ] Confirmação mostra número do pedido e valor pago iguais ao checkout
  - [ ] Recarregar a confirmação não volta para o QR
- **Non-goals**: e-mail de recibo e estorno
