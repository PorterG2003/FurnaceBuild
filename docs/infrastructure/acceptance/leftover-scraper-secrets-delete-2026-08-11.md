# Acceptance — leftover scraper + secrets deletion

- Profile: furnace-admin (IAM user admin)
- Account: 686255981838
- Started (UTC): 2026-08-11T19:07:34Z

## Pre-delete inventory

### ALB
{
    "arn": "arn:aws:elasticloadbalancing:us-west-2:686255981838:loadbalancer/app/api-doc-scraper-alb/e6d203ba068572d0",
    "dns": "api-doc-scraper-alb-1774956205.us-west-2.elb.amazonaws.com",
    "vpc": "vpc-0b6c2c36df8761124"
}

### EIP
{
    "Addresses": [
        {
            "PublicIp": "16.144.197.194",
            "AllocationId": "eipalloc-03786bbfdd73c6489",
            "AssociationId": "eipassoc-020a449946cf0117f",
            "Domain": "vpc",
            "NetworkInterfaceId": "eni-0301b15621180548e",
            "NetworkInterfaceOwnerId": "686255981838",
            "PrivateIpAddress": "10.0.0.35",
            "PublicIpv4Pool": "amazon",
            "NetworkBorderGroup": "us-west-2"
        }
    ]
}

### Secrets
[
    "SERPAPI",
    "DocFinderAPI",
    "OpenAI",
    "furnace/integrations/18512320-7041-70b3-b1bb-55cbcadc44b7/4c07f0fa-c83f-4e4c-a61d-46143fb56d32",
    "furnace/integrations/18512320-7041-70b3-b1bb-55cbcadc44b7/0d8ecc9d-5594-448a-b497-d138800058bd",
    "furnace/integrations/68412390-a031-706f-9882-b6f13684398b/e42dacde-1140-4022-a361-cc9aa5c7c0a8",
    "furnace/integrations/c801c3b0-30d1-7037-2bf1-e229d300d7dc/d877bf8e-0a5a-45da-bad0-139484642227",
    "furnace/integrations/18512320-7041-70b3-b1bb-55cbcadc44b7/256a8c1a-7fed-4dc5-82b1-a685968d9037",
    "furnace/integrations/18512320-7041-70b3-b1bb-55cbcadc44b7/10b03d0f-5070-4bb6-8287-00d01d2df273",
    "furnace/integrations/18512320-7041-70b3-b1bb-55cbcadc44b7/70303e1d-ff40-4d98-adba-88a622328534",
    "furnace/integrations/08a1c3c0-b0b1-7064-935b-ff7e98cca969/31ba577b-c67a-4ef2-b4c9-a21d39e2e07f",
    "furnace/integrations/f891d3c0-50c1-70d5-3b13-d4577d00dddb/8b9f99e1-4465-4a9b-9d62-240818808227",
    "furnace/integrations/e8d173e0-9051-70a0-be5f-1c4fb540350a/1a8d36b4-49f6-47ad-87a1-cdf490eab470",
    "furnace/integrations/38b1b3e0-0051-7063-5b3a-3af6161ef683/1f380615-f290-4748-8073-71f7261152d9",
    "furnace/integrations/b8814390-d0d1-70d9-c2f8-bda2d236ffa9/dfade279-302f-41ae-bd75-c44de94c503a",
    "furnace/integrations/b8814390-d0d1-70d9-c2f8-bda2d236ffa9/8a7ee42a-3d02-4a00-bb99-6ede4dc1dfaa",
    "furnace/integrations/78e17370-f0e1-7030-b7de-0bb67980fb5e/6c7c70e1-d224-454a-8514-a98484bfc605",
    "furnace/integrations/78e17370-f0e1-7030-b7de-0bb67980fb5e/61ff6e43-f19b-435e-a52b-415d27b1b47c",
    "furnace/integrations/78e17370-f0e1-7030-b7de-0bb67980fb5e/71df3b56-ccef-4e02-adc4-e28c77aca5b4"
]

## Result (UTC 2026-08-11)

Deleted:

- ALB `api-doc-scraper-alb` + target group
- EIP `16.144.197.194` (gone after ALB teardown)
- VPC `vpc-0b6c2c36df8761124` (IGW, subnets, `api-doc-scraper-sg`)
- CloudFormation stack `APIDocScraper` (Lambda + API Gateway)
- ACM cert for `doc-scraper.connectwithbind.com`
- All 19 Secrets Manager secrets scheduled with 7-day recovery

No Route 53 records in this account pointed at the ALB/EIP. If `doc-scraper.connectwithbind.com` is hosted elsewhere, remove that record separately.

Prod ECS still 1/1/1.
