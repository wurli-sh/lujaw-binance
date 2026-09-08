import { DocsSection } from "@/components/DocsSection";
import { Footer } from "@/components/Footer";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { Nav } from "@/components/Nav";

export default function HomePage() {
  return (
    <div className="bg-background">
      <Nav />
      <main>
        <Hero />
        <HowItWorks />
        <DocsSection />
      </main>
      <Footer />
    </div>
  );
}
