variable "excluded_providers" {
  default = []
}

variable "lambda_schedule_expression" {
  default = "rate(10 minutes)"
}

