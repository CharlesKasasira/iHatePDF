import { SignatureWorkflowStudio } from "../components/signature-workflow-studio";

export default async function SignPdfPage({
  searchParams
}: {
  searchParams?: Promise<{
    envelope?: string;
  }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  return <SignatureWorkflowStudio initialEnvelopeId={params?.envelope ?? null} />;
}
