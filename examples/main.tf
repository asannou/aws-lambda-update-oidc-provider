provider "aws" {
  region = "ap-northeast-1"
}

module "aws_lambda_update_oidc_provider" {
  source = "github.com/asannou/terraform-aws-lambda-update-oidc-provider"
  excluded_providers = [
    "login.windows.net/common"
  ]
  lambda_schedule_expression = "rate(10 minutes)"
}

