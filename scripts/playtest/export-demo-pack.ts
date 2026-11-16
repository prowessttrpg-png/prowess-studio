import { writeFile } from "node:fs/promises";
import { assertRunningAgainstTestDatabase, prisma } from "../../packages/prowess-db/src/index";
import { exportContentPack, readContentPack } from "../../packages/prowess-db/src/content-pack/index";

const [releaseId, producerId, output] = process.argv.slice(2);
if (!releaseId || !producerId || !output) throw new Error("Supply the exact sample Release, producer ID, and destination.");
assertRunningAgainstTestDatabase(process.env.DATABASE_URL!);
try {
  const bytes = await exportContentPack(releaseId, {
    producerId, label: "Demo — sample rules", provenance: { claimedCreator: "Prowess playtest", category: "sample" },
  });
  const { archiveSha256, manifest } = readContentPack(bytes);
  await writeFile(output, bytes, { flag: "wx" });
  console.log(JSON.stringify({ archiveSha256, contentDigest: manifest.contentDigest, releaseId: manifest.release.releaseId }));
} finally {
  await prisma.$disconnect();
}
