import com.sun.codemodel.JCodeModel
import org.jsonschema2pojo._
import org.jsonschema2pojo.rules.RuleFactory
import java.io.File

object Jsonschema2Pojo {

  def generate(schemaDir: File, outputDir: File, targetPackage: String): Seq[File] = {
    outputDir.mkdirs()

    val config = new DefaultGenerationConfig() {
      override def getSourceType: SourceType = SourceType.JSONSCHEMA
      override def getAnnotationStyle: AnnotationStyle = AnnotationStyle.JACKSON2
      override def getTargetDirectory: File = outputDir
      override def getTargetPackage: String = targetPackage
      override def isIncludeHashcodeAndEquals: Boolean = false
      override def isIncludeToString: Boolean = false
      override def isIncludeAdditionalProperties: Boolean = false
      override def isIncludeGeneratedAnnotation: Boolean = false
      override def isUseTitleAsClassname: Boolean = false
      override def getInclusionLevel: InclusionLevel = InclusionLevel.ALWAYS
      override def getFileExtensions: Array[String] = Array(".schema.json")

      override def isIncludeConstructors: Boolean = true
    }

    val ruleFactory = new RuleFactory(config, new Jackson2Annotator(config), new SchemaStore())
    val mapper = new SchemaMapper(ruleFactory, new SchemaGenerator())

    val schemaFiles = schemaDir.listFiles().filter(_.getName.endsWith(".schema.json"))
    schemaFiles.foreach { schema =>
      val className = schema.getName.replace(".schema.json", "").capitalize
      val codeModel = new JCodeModel()
      mapper.generate(codeModel, className, targetPackage, schema.toURI.toURL)
      codeModel.build(outputDir)
    }

    // Collect all generated .java files
    def collectJavaFiles(dir: File): Seq[File] = {
      if (!dir.exists()) Seq.empty
      else {
        val files = dir.listFiles()
        files.filter(_.getName.endsWith(".java")) ++ files.filter(_.isDirectory).flatMap(collectJavaFiles)
      }
    }
    collectJavaFiles(outputDir)
  }
}
