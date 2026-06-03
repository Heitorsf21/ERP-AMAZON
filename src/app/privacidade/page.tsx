import Image from "next/image";
import type { Metadata } from "next";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Política de Privacidade — Atlas Seller",
  description:
    "Como o Atlas Seller (MundoFS) trata os dados das contas de vendedor conectadas e os dados obtidos via Amazon SP-API e Amazon Ads API.",
};

const ATUALIZADO_EM = "3 de junho de 2026";
const CONTATO = "admfsmundo@gmail.com";

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{titulo}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export default function PrivacidadePage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-5 py-4">
          <Image
            src="/atlas-symbol.png"
            alt="Atlas Seller"
            width={28}
            height={28}
            priority
            className="object-contain"
            style={{ height: 28, width: 28 }}
          />
          <span className="text-sm font-semibold tracking-tight">Atlas Seller</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 px-5 py-10">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Política de Privacidade</h1>
          <p className="text-sm text-muted-foreground">Atualizada em {ATUALIZADO_EM}.</p>
        </div>

        <Secao titulo="1. Quem somos">
          <p>
            O <strong>Atlas Seller</strong> é uma plataforma de gestão (ERP) operada pela{" "}
            <strong>MundoFS</strong> que ajuda vendedores da Amazon a administrar vendas,
            finanças, estoque e publicidade. Esta política descreve como tratamos os dados
            acessados quando um vendedor conecta a própria conta Amazon ao Atlas Seller.
          </p>
          <p>
            Controlador / contato:{" "}
            <a className="text-primary underline-offset-2 hover:underline" href={`mailto:${CONTATO}`}>
              {CONTATO}
            </a>
            .
          </p>
        </Secao>

        <Secao titulo="2. Dados que tratamos">
          <p>Ao conectar sua conta Amazon (via OAuth) e usar o sistema, tratamos:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Credenciais de autorização</strong> (tokens OAuth da Amazon SP-API e
              Amazon Ads) — armazenadas <strong>cifradas</strong> e escopadas por conta.
            </li>
            <li>
              <strong>Dados de negócio do vendedor</strong> obtidos via API: pedidos, itens,
              valores financeiros, liquidações, estoque/inventário, métricas de anúncios e
              catálogo.
            </li>
            <li>
              <strong>Dados de identificação do comprador (PII)</strong>: por padrão,{" "}
              <strong>não persistimos</strong> nome, endereço ou telefone do comprador nos
              nossos modelos de venda. Quando dados brutos de pedido são recebidos da Amazon,
              são minimizados e/ou cifrados e <strong>purgados automaticamente em até 30 dias</strong>.
            </li>
            <li>
              <strong>Dados de conta de usuário</strong> do Atlas Seller: nome, e-mail e
              credenciais de acesso (senha com hash).
            </li>
          </ul>
        </Secao>

        <Secao titulo="3. Finalidade e base">
          <p>
            Usamos os dados <strong>exclusivamente</strong> para prestar o serviço ao próprio
            vendedor: sincronizar e exibir suas vendas, finanças, estoque e publicidade;
            conciliar recebimentos; e gerar indicadores. O tratamento ocorre mediante a{" "}
            <strong>autorização (consentimento) do vendedor</strong> concedida no fluxo OAuth,
            e pode ser revogada a qualquer momento.
          </p>
        </Secao>

        <Secao titulo="4. Compartilhamento e sub-processadores">
          <p>
            <strong>Não vendemos</strong> dados e <strong>não compartilhamos</strong> dados de
            um vendedor com outro. Cada empresa é isolada logicamente. Utilizamos
            sub-processadores estritamente necessários à operação:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>Amazon</strong> (SP-API / Advertising API) — origem dos dados.</li>
            <li><strong>Provedor de hospedagem</strong> (servidor/infraestrutura do Atlas Seller).</li>
            <li>
              Serviço de IA para <strong>extração de documentos financeiros</strong> enviados
              pelo próprio usuário (quando essa função é usada).
            </li>
          </ul>
        </Secao>

        <Secao titulo="5. Segurança">
          <ul className="list-disc space-y-1 pl-5">
            <li>Cifragem de credenciais e segredos em repouso (AES-256-GCM).</li>
            <li>Cifragem em trânsito (TLS).</li>
            <li>Isolamento estrito de dados entre empresas (multi-tenant fail-closed).</li>
            <li>Controle de acesso por papel (RBAC) e autenticação com sessão assinada.</li>
            <li>Trilha de auditoria de acessos e ações sobre dados sensíveis.</li>
          </ul>
        </Secao>

        <Secao titulo="6. Retenção e exclusão">
          <p>
            Dados de identificação de comprador em payloads de pedido são purgados em{" "}
            <strong>até 30 dias</strong>. Os demais dados de negócio são mantidos enquanto a
            conta estiver ativa e enquanto necessário para a finalidade. Ao desconectar a
            conta Amazon ou solicitar a exclusão, removemos as credenciais e os dados
            associados conforme a solicitação.
          </p>
        </Secao>

        <Secao titulo="7. Seus direitos">
          <p>
            Você pode solicitar acesso, correção ou exclusão dos seus dados, e revogar a
            autorização da Amazon a qualquer momento (em <code>/amazon</code> → Desconectar, ou
            no próprio Seller Central). Para solicitações, escreva para{" "}
            <a className="text-primary underline-offset-2 hover:underline" href={`mailto:${CONTATO}`}>
              {CONTATO}
            </a>
            .
          </p>
        </Secao>

        <Secao titulo="8. Incidentes de segurança">
          <p>
            Mantemos um plano de resposta a incidentes. Em caso de incidente de segurança
            envolvendo dados protegidos, notificamos as partes afetadas e a Amazon dentro dos
            prazos exigidos pela política aplicável.
          </p>
        </Secao>

        <Secao titulo="9. Alterações">
          <p>
            Podemos atualizar esta política. A data de “Atualizada em” no topo indica a versão
            vigente.
          </p>
        </Secao>

        <footer className="border-t border-border pt-6 text-xs text-muted-foreground">
          Atlas Seller · MundoFS — {CONTATO}
        </footer>
      </main>
    </div>
  );
}
