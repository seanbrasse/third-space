import ThirdSpace from "../components/ThirdSpace";
import history from "../../../releases/history.json";
import { publishedReleases } from "../lib/release-history";
export default function Page() {
  return <ThirdSpace updates={publishedReleases(history)} />;
}
