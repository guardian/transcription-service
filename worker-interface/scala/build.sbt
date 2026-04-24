import ReleaseTransformations._
import sbtversionpolicy.withsbtrelease.ReleaseVersion.fromAssessedCompatibilityWithLatestRelease

name := "transcription-service-worker-interface"
organization := "com.gu"
licenses := Seq(License.Apache2)
scalaVersion := "2.13.16"
crossPaths := false
autoScalaLibrary := false
scalacOptions ++= Seq("-release:11")

val jacksonVersion = "2.18.3"

libraryDependencies ++= Seq(
  "com.fasterxml.jackson.core" % "jackson-annotations" % jacksonVersion
)

Compile / sourceGenerators += Def.task {
  val schemaDir = baseDirectory.value / ".." / ".." / "packages" / "common" / "schema"
  val outputDir = (Compile / sourceManaged).value / "jsonschema2pojo"
  Jsonschema2Pojo.generate(schemaDir, outputDir, "com.gu.transcriptionservice")
}.taskValue

releaseVersion := fromAssessedCompatibilityWithLatestRelease().value
releaseProcess := Seq[ReleaseStep](
  checkSnapshotDependencies,
  inquireVersions,
  runClean,
  runTest,
  setReleaseVersion,
  commitReleaseVersion,
  tagRelease,
  setNextVersion,
  commitNextVersion
)
