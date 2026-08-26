# Decisions: Checkout Pix

## Modelo de pagamento
- **Question**: O checkout gera o QR no backend da loja ou redireciona para o PSP?
- **Decision**: O backend da loja gera o QR (`POST /checkout/pix` devolve 200 com QR, valor e prazo) e o cliente permanece na loja.
- **Rejected**: Redirecionar para o PSP — o cliente sai do checkout e a confirmação deixa de ser da loja.
